// js/physics.js
// Planck.js (Box2D port) physics world wrapper.
// - Fixed timestep (CONFIG.FIXED_DT) with an accumulator → framerate independent.
// - Terrain is built from ChainShapes WITH ghost vertices (prev/next) → no ghost collisions.
(function (root) {
  const planck = root.planck;

  class PhysicsWorld {
    constructor() {
      this.world = null;
      this.accumulator = 0;
      this.simTime = 0;          // seconds of simulated time
      this.stepCount = 0;
      this.preSolveHandlers = [];
      this.categories = {
        TERRAIN: 0x0001,
        VEHICLE: 0x0002,
        WHEEL:   0x0004,
        HEAD:    0x0008,
        GEM:     0x0010,
        HAZARD:  0x0020,
      };
    }

    init() {
      const C = this.categories;
      this.world = planck.World({ gravity: planck.Vec2(0, -CONFIG.GRAVITY) });
      this.accumulator = 0;
      this.simTime = 0;
      this.stepCount = 0;
      this.preSolveHandlers = [];

      this.filterTerrain = { filterCategoryBits: C.TERRAIN, filterMaskBits: C.WHEEL | C.HEAD | C.VEHICLE, filterGroupIndex: 0 };
      this.filterWheel   = { filterCategoryBits: C.WHEEL,   filterMaskBits: C.TERRAIN | C.HAZARD, filterGroupIndex: -1 };
      this.filterHead    = { filterCategoryBits: C.HEAD,    filterMaskBits: C.TERRAIN | C.HAZARD, filterGroupIndex: -1 };
      this.filterVehicle = { filterCategoryBits: C.VEHICLE, filterMaskBits: C.TERRAIN, filterGroupIndex: -1 };

      // Single pre-solve dispatcher (loops use it to disable the "other side" of the loop)
      this.world.on('pre-solve', (contact, oldManifold) => {
        for (let i = 0; i < this.preSolveHandlers.length; i++) this.preSolveHandlers[i](contact, oldManifold);
      });
    }

    addPreSolve(fn) { this.preSolveHandlers.push(fn); }

    /**
     * Advance the simulation by a (variable) frame delta using a fixed timestep.
     * beforeStep(dt) is called before each fixed step (apply forces / motor),
     * afterStep(dt) right after each step (contact polling / crash checks).
     * Returns the number of fixed steps executed.
     */
    step(dt, beforeStep, afterStep) {
      if (!this.world) return 0;
      this.accumulator += Math.min(Math.max(dt, 0), CONFIG.MAX_FRAME_DT);
      let steps = 0;
      while (this.accumulator >= CONFIG.FIXED_DT) {
        if (beforeStep) beforeStep(CONFIG.FIXED_DT);
        this.world.step(CONFIG.FIXED_DT, CONFIG.PHYSICS_ITERATIONS, CONFIG.PHYSICS_ITERATIONS);
        this.simTime += CONFIG.FIXED_DT;
        this.stepCount++;
        if (afterStep) afterStep(CONFIG.FIXED_DT);
        this.accumulator -= CONFIG.FIXED_DT;
        steps++;
      }
      return steps;
    }

    /** Interpolation factor between the previous and current physics state (0..1). */
    alpha() { return this.accumulator / CONFIG.FIXED_DT; }

    /**
     * Create a static terrain chain from {x,y} points.
     * opts.prev / opts.next: ghost vertices ({x,y}) that connect this chain smoothly to neighbours.
     * opts.userData: attached to the fixture (e.g. {terrain:true, loop:id, part:'A'})
     */
    createChain(points, opts = {}) {
      const verts = [];
      for (const p of points) {
        const last = verts[verts.length - 1];
        if (last && (last.x - p.x) * (last.x - p.x) + (last.y - p.y) * (last.y - p.y) < 1e-4) continue;
        verts.push(planck.Vec2(p.x, p.y));
      }
      if (verts.length < 2) return null;
      const body = this.world.createBody({ type: 'static' });
      if (opts.loop) {
        const a = verts[0], b = verts[verts.length - 1];
        if ((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y) < 1e-4) verts.pop();
        if (verts.length < 3) return null;
      }
      const chain = planck.Chain(verts, !!opts.loop); // open chain = polyline terrain, loop = closed slab
      if (!opts.loop && opts.prev) chain._setPrevVertex(planck.Vec2(opts.prev.x, opts.prev.y));
      if (!opts.loop && opts.next) chain._setNextVertex(planck.Vec2(opts.next.x, opts.next.y));
      const fix = body.createFixture(chain, Object.assign({
        friction: CONFIG.TERRAIN_FRICTION,
        restitution: CONFIG.TERRAIN_RESTITUTION,
      }, this.filterTerrain));
      fix.setUserData(Object.assign({ terrain: true }, opts.userData || {}));
      body.setUserData({ type: 'terrain', minX: verts[0].x, maxX: verts[verts.length - 1].x });
      return body;
    }

    /** Backwards-compatible helper: whole polyline as one chain. */
    createTerrain(points) { return this.createChain(points); }

    /** Static or kinematic box that behaves like terrain (platforms). */
    createBox(cx, cy, hw, hh, type = 'static', userData = {}) {
      const body = this.world.createBody({ type, position: planck.Vec2(cx, cy) });
      const fix = body.createFixture(planck.Box(hw, hh), Object.assign({
        friction: CONFIG.TERRAIN_FRICTION, restitution: 0, density: 1,
      }, this.filterTerrain));
      fix.setUserData(Object.assign({ terrain: true }, userData));
      body.setUserData({ type: 'platform', minX: cx - hw, maxX: cx + hw });
      return body;
    }

    destroyBody(body) {
      if (this.world && body) {
        try { this.world.destroyBody(body); } catch (e) { /* already destroyed */ }
      }
    }

    destroy() {
      if (this.world) {
        let body = this.world.getBodyList();
        while (body) {
          const next = body.getNext();
          this.world.destroyBody(body);
          body = next;
        }
        this.world = null;
      }
      this.preSolveHandlers = [];
    }

    getWorld() { return this.world; }
  }

  root.PhysicsWorld = PhysicsWorld;
})(typeof window !== 'undefined' ? window : globalThis);
