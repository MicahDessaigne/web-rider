// js/track.js — Procedural / level track generation, physics terrain, gems, hazards and platforms.
//
// The track is a sequence of obstacle pieces (js/track-pieces.js) separated by recovery flats.
// Ground polylines that touch end-to-end are merged into one continuous "run" which is emitted
// as ChainShape chunks (CONFIG.TERRAIN_CHUNK_VERTS vertices each) with ghost vertices on both
// sides, so wheels never catch on a seam between chunks or pieces.
(function (root) {
  /** Small, fast, seedable PRNG. */
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const EPS2 = 1e-6;
  const same = (a, b) => (a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y) < EPS2;

  class Track {
    /**
     * @param {PhysicsWorld} pw
     * @param {object} opts { seed, length (level finish distance, 0 = endless), minDifficulty,
     *                        maxDifficulty, pool (array of piece ids), startFlat }
     */
    constructor(pw, opts = {}) {
      this.pw = pw;
      this.seed = (opts.seed === undefined ? CONFIG.TRACK_SEED_DEFAULT : opts.seed) >>> 0;
      this.rng = mulberry32(this.seed);
      this.levelLength = opts.length || 0;
      this.minDifficulty = opts.minDifficulty || 1;
      this.maxDifficulty = opts.maxDifficulty || 10;
      this.pool = opts.pool || null;
      this.startFlat = opts.startFlat || 60;
      this.noAuto = !!opts.manual;      // tests place pieces themselves

      this.segments = [];      // render segments {kind, pts, minX, maxX, thick, closed, loop, part}
      this.bodies = [];        // {body, maxX}
      this.gems = [];          // {x, y, taken, t}
      this.hazards = [];       // world-space hazards with runtime state
      this.loops = [];         // loop state objects (index = global id; null once cleaned)
      this.platforms = [];     // {def, body, ...}
      this.safeSpots = [];     // {x, y} flat spots for revive
      this.placed = [];        // {piece, sx, sy, ex, ey}

      this.pending = [];       // current open ground run (not yet emitted)
      this.pendingPrev = null; // ghost vertex before pending[0]

      this.genX = -30; this.genY = 0;
      this.minY = 0; this.maxY = 0;
      this.finishX = Infinity;
      this.finished = false;
      this.lastHard = false;
      this.lastId = -1;
      this.recent = [];
      this.time = 0;

      this.onGem = null;        // (gem) => void
      this.onNearMiss = null;   // (hazard) => void
      this.onBoost = null;      // (hazard) => void
      this.onBounce = null;     // (hazard) => void
      this.onFinish = null;     // () => void
    }

    // ─────────────────────────────── generation ───────────────────────────────
    initStart() {
      const pts = [];
      const n = Math.ceil((this.startFlat - this.genX) / 2);
      for (let i = 0; i <= n; i++) pts.push({ x: this.genX + (this.startFlat - this.genX) * i / n, y: 0 });
      // a tall back wall so nobody rolls off the start
      this._addGroundSeg({ kind: 'ground', pts: [{ x: this.genX - 0.1, y: 12 }, ...pts] });
      this.genX = this.startFlat; this.genY = 0;
      this.safeSpots.push({ x: 2, y: 0 });
      if (!this.noAuto) this.ensureGeneratedAhead(0);
    }

    /** Difficulty ceiling at a given distance. */
    difficultyAt(x) {
      const t = Math.max(0, x) / CONFIG.DIFFICULTY_RAMP_DIST;
      return Math.max(this.minDifficulty, Math.min(this.maxDifficulty, 2 + t * 8));
    }

    ensureGeneratedAhead(x) {
      if (this.noAuto) { this._flushIfClose(x); return; }
      let guard = 0;
      while (!this.finished && this.genX < x + CONFIG.GENERATE_AHEAD && guard++ < 50) {
        if (this.levelLength && this.genX >= this.levelLength) { this._placeFinish(); break; }
        this._placeNext();
      }
      this._flushIfClose(x);
    }

    _flushIfClose(x) {
      if (this.pending.length >= 2 && this.pending[0].x < x + 80) this._emit(true);
    }

    _pickPiece() {
      const all = root.TRACK_PIECES;
      const dmax = this.difficultyAt(this.genX);
      const forceCalm = this.lastHard;
      let candidates = (this.pool ? this.pool.map(i => all[i]) : all).filter(p => p && p.id !== this.lastId && !this.recent.includes(p.id));
      if (forceCalm) {
        const calm = candidates.filter(p => p.calm || p.difficulty <= 2);
        if (calm.length) candidates = calm;
      } else {
        const ok = candidates.filter(p => p.difficulty <= dmax + 0.01);
        if (ok.length) candidates = ok;
      }
      if (!candidates.length) candidates = all.filter(p => p.calm);
      // Weight: favour pieces close to the current difficulty ceiling
      let total = 0;
      const w = candidates.map(p => { const v = 1 / (1 + Math.abs(dmax - p.difficulty) * 0.6); total += v; return v; });
      let r = this.rng() * total;
      for (let i = 0; i < candidates.length; i++) { r -= w[i]; if (r <= 0) return candidates[i]; }
      return candidates[candidates.length - 1];
    }

    _placeNext() {
      const piece = this._pickPiece();
      // Recovery flat sized so the bike can reach the piece's entry speed
      const lead = piece.minSpeed >= 14 ? 26 : piece.minSpeed >= 8 ? 18 : 8;
      const extra = Math.floor(this.rng() * 6);
      this.addFlat(lead + extra);
      this.placePiece(piece);
      this.lastHard = piece.difficulty >= 6 || piece.tags.includes('loop');
      this.lastId = piece.id;
      this.recent.push(piece.id); if (this.recent.length > 6) this.recent.shift();
    }

    /** Straight flat continuing the current run (also a revive spot). */
    addFlat(len) {
      const pts = [{ x: this.genX, y: this.genY }];
      const n = Math.max(1, Math.ceil(len / 2));
      for (let i = 1; i <= n; i++) pts.push({ x: this.genX + len * i / n, y: this.genY });
      this.safeSpots.push({ x: this.genX + 1.5, y: this.genY });
      this._addGroundSeg({ kind: 'ground', pts });
      this.genX += len;
    }

    /** Place a specific obstacle piece at the current end of the track. */
    placePiece(piece) {
      const sx = this.genX, sy = this.genY;
      const g = piece.build(sx, sy);
      const loopBase = this.loops.length;
      for (const L of g.loops) {
        this.loops.push({ cx: L.cx, cy: L.cy, r: L.r, phase: 'A', acc: 0, prevPhi: 0, checked: false, assist: false, completed: false });
      }
      for (const s of g.segs) {
        if (s.kind === 'ground' || s.kind === 'bridge') this._addGroundSeg(s);
        else if (s.kind === 'loopA' || s.kind === 'loopB') this._addLoopSeg(s, loopBase + s.loop);
        else if (s.kind === 'island' || s.kind === 'ceiling') this._addClosedSeg(s);
      }
      for (const gm of g.gems) this.gems.push({ x: gm.x, y: gm.y, taken: false, t: 0 });
      for (const h of g.hazards) this.hazards.push(Object.assign({ minDist: Infinity, passed: false, cool: 0 }, h));
      for (const p of g.platforms) this._addPlatform(p);
      this.placed.push({ piece, sx, sy, ex: g.exit.x, ey: g.exit.y });
      this.genX = g.exit.x; this.genY = g.exit.y;
    }

    _placeFinish() {
      this.finishX = this.genX + 10;
      this.addFlat(90);
      this.finished = true;
      this._emit(true);
    }

    // ─────────────────────────────── terrain bodies ───────────────────────────────
    _trackBounds(pts) {
      let minX = Infinity, maxX = -Infinity;
      for (const p of pts) {
        if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
        if (p.y < this.minY) this.minY = p.y; if (p.y > this.maxY) this.maxY = p.y;
      }
      return { minX, maxX };
    }

    _addGroundSeg(s) {
      const pts = s.pts.map(p => ({ x: p.x, y: p.y }));
      if (pts.length < 2) return;
      const b = this._trackBounds(pts);
      this.segments.push({ kind: s.kind, pts, minX: b.minX, maxX: b.maxX, thick: s.thick || 0 });
      // physics: continue or restart the pending run
      const last = this.pending[this.pending.length - 1];
      if (last && same(last, pts[0])) {
        for (let i = 1; i < pts.length; i++) this.pending.push(pts[i]);
      } else {
        if (this.pending.length) this._emit(true);
        this.pending = pts.slice();
        this.pendingPrev = null;
      }
      this._emit(false);
    }

    /** Emit chain chunks from the pending run. final=true flushes everything. */
    _emit(final) {
      const N = CONFIG.TERRAIN_CHUNK_VERTS;
      while (this.pending.length > N + 2) {
        const chunk = this.pending.slice(0, N + 1);
        this._createChainBody(chunk, this.pendingPrev, this.pending[N + 1]);
        this.pendingPrev = this.pending[N - 1];
        this.pending = this.pending.slice(N);
      }
      if (final && this.pending.length >= 2) {
        this._createChainBody(this.pending, this.pendingPrev, null);
        // keep the last vertex so a continuing run stays seamless (ghost vertex)
        const n = this.pending.length;
        this.pendingPrev = this.pending[n - 2];
        this.pending = [this.pending[n - 1]];
      } else if (final) {
        this.pending = [];
      }
    }

    _createChainBody(pts, prev, next, userData) {
      const body = this.pw.createChain(pts, { prev, next, userData });
      if (body) {
        let maxX = -Infinity; for (const p of pts) if (p.x > maxX) maxX = p.x;
        this.bodies.push({ body, maxX });
      }
      return body;
    }

    _addLoopSeg(s, loopId) {
      const pts = s.pts.map(p => ({ x: p.x, y: p.y }));
      const b = this._trackBounds(pts);
      this.segments.push({ kind: s.kind, pts, minX: b.minX, maxX: b.maxX, loop: loopId, part: s.part });
      const L = this.loops[loopId];
      // ghost vertices: smooth entry from the flat for A; smooth exit onto the flat for B
      let prev = null, next = null;
      if (s.part === 'A') prev = { x: pts[0].x - 0.5, y: pts[0].y };
      else next = { x: pts[pts.length - 1].x + 0.5, y: pts[pts.length - 1].y };
      const body = this.pw.createChain(pts, { prev, next, userData: { loop: loopId, part: s.part } });
      if (body) this.bodies.push({ body, maxX: L.cx + L.r + 1 });
    }

    _addClosedSeg(s) {
      const pts = s.pts.map(p => ({ x: p.x, y: p.y }));
      const b = this._trackBounds(pts);
      this.segments.push({ kind: s.kind, pts, minX: b.minX, maxX: b.maxX, closed: true });
      const body = this.pw.createChain(pts, { loop: true });
      if (body) this.bodies.push({ body, maxX: b.maxX });
    }

    _addPlatform(p) {
      const type = p.type === 'moving' ? 'kinematic' : 'static';
      const body = this.pw.createBox(p.cx, p.cy, p.hw, p.hh, type, { platform: true });
      this.platforms.push({ def: p, body, x: p.cx, y: p.cy, timer: -1, crumbled: false, shake: 0 });
      this.segments.push({ kind: 'platform', pts: [], minX: p.cx - p.hw - (p.range || 0), maxX: p.cx + p.hw + (p.range || 0), platform: this.platforms[this.platforms.length - 1] });
      if (p.cy - p.hh < this.minY) this.minY = p.cy - p.hh;
    }

    // ─────────────────────────────── queries ───────────────────────────────
    /** Surface (ground/bridge/island top) height below y at x. Returns null if none. */
    _surfaceAt(x, y) {
      let best = null, bestAngle = 0;
      for (const s of this.segments) {
        if (x < s.minX || x > s.maxX || !s.pts.length) continue;
        if (s.kind === 'loopA' || s.kind === 'loopB') continue;
        const pts = s.pts;
        for (let i = 0; i < pts.length - 1; i++) {
          const p = pts[i], q = pts[i + 1];
          if (q.x - p.x < 1e-3) continue;          // walls / reversed edges
          if (x < p.x || x > q.x) continue;
          const yy = p.y + (q.y - p.y) * (x - p.x) / (q.x - p.x);
          if (yy <= y + 0.6 && (best === null || yy > best)) { best = yy; bestAngle = Math.atan2(q.y - p.y, q.x - p.x); }
        }
      }
      return best === null ? null : { y: best, angle: bestAngle };
    }
    getGroundAngleAt(x, y = 1e9) { const s = this._surfaceAt(x, y); return s ? s.angle : 0; }
    getGroundYAt(x, y = 1e9) { const s = this._surfaceAt(x, y); return s ? s.y : null; }
    getSegmentsInRange(x0, x1) { return this.segments.filter(s => s.maxX >= x0 && s.minX <= x1); }
    getPointsInRange(x0, x1) {
      const out = [];
      for (const s of this.segments) if ((s.kind === 'ground' || s.kind === 'bridge') && s.maxX >= x0 && s.minX <= x1) for (const p of s.pts) if (p.x >= x0 && p.x <= x1) out.push(p);
      return out;
    }

    /** Safe revive position behind x (on a recovery flat). */
    findSafeRespawn(x) {
      let spot = this.safeSpots[0];
      for (const s of this.safeSpots) { if (s.x < x - 2) spot = s; else break; }
      // reset loops ahead so they can be ridden again
      for (const L of this.loops) if (L && L.cx > spot.x) { L.phase = 'A'; L.acc = 0; L.assist = false; L.checked = false; }
      for (const h of this.hazards) if ((h.x0 !== undefined ? h.x0 : h.x || h.px || 0) > spot.x) { h.passed = false; h.minDist = Infinity; }
      return { x: spot.x + 1.0, y: spot.y + CONFIG.WHEEL_RADIUS - CONFIG.WHEEL_Y_OFFSET + 0.05 };
    }

    /** Free physics bodies & render data far behind the bike. */
    cleanupBehind(x) {
      const limit = x - CONFIG.TERRAIN_CLEANUP_BEHIND;
      this.bodies = this.bodies.filter(b => { if (b.maxX < limit) { this.pw.destroyBody(b.body); return false; } return true; });
      this.segments = this.segments.filter(s => s.maxX >= limit);
      this.gems = this.gems.filter(g => g.x >= limit);
      this.hazards = this.hazards.filter(h => {
        const hx = h.x1 !== undefined ? h.x1 : (h.x !== undefined ? h.x + (h.w || 0) + (h.r || 0) : (h.px || 0) + (h.len || 0));
        return hx >= limit;
      });
      this.platforms = this.platforms.filter(p => { if (p.def.cx + p.def.hw + 20 < limit) { this.pw.destroyBody(p.body); return false; } return true; });
      for (let i = 0; i < this.loops.length; i++) if (this.loops[i] && this.loops[i].cx + this.loops[i].r < limit) this.loops[i] = null;
      const keep = this.safeSpots.filter(s => s.x >= limit + 5);
      this.safeSpots = keep.length ? keep : this.safeSpots.slice(-1);
      this.placed = this.placed.filter(p => p.ex >= limit);
    }

    /** Pendulum bob position at the current time. */
    pendulumBob(h) {
      const a = h.amp * Math.sin(2 * Math.PI * this.time / h.period);
      return { x: h.px + h.len * Math.sin(a), y: h.py - h.len * Math.cos(a), a };
    }

    // ─────────────────────────────── per-step update ───────────────────────────────
    update(dt, vehicle) {
      this.time += dt;
      this._updatePlatforms(dt, vehicle);
      if (!vehicle || vehicle.crashed) return;
      const pos = vehicle.getPosition();
      const circles = vehicle.getHitCircles();
      const grace = vehicle.age * 1000 > CONFIG.CRASH_GRACE_MS;

      // Gems
      for (const g of this.gems) {
        if (g.taken || Math.abs(g.x - pos.x) > 3) continue;
        for (const c of circles) {
          const dx = c.x - g.x, dy = c.y - g.y;
          if (dx * dx + dy * dy < (c.r + 0.55) * (c.r + 0.55)) { g.taken = true; if (this.onGem) this.onGem(g); break; }
        }
      }

      // Hazards
      for (const h of this.hazards) {
        switch (h.type) {
          case 'pit':
            if (pos.x > h.x0 && pos.x < h.x1 && pos.y < h.y && grace) { vehicle.crash('pit'); return; }
            break;
          case 'spike': {
            if (pos.x < h.x - 4 || pos.x > h.x + h.w + 4) { this._nearMissPass(h, pos.x > h.x + h.w + 4); break; }
            let hit = false;
            for (const c of circles) {
              const cx = Math.max(h.x, Math.min(h.x + h.w, c.x)), cy = Math.max(h.y, Math.min(h.y + h.h, c.y));
              const d = Math.hypot(c.x - cx, c.y - cy) - c.r;
              if (d < h.minDist) h.minDist = d;
              if (d < -0.05) hit = true;
            }
            if (hit && grace) { vehicle.crash('spike'); return; }
            break;
          }
          case 'saw': {
            if (Math.abs(pos.x - h.x) > h.r + 5) { this._nearMissPass(h, pos.x > h.x + h.r + 5); break; }
            for (const c of circles) {
              const d = Math.hypot(c.x - h.x, c.y - h.y) - h.r - c.r;
              if (d < h.minDist) h.minDist = d;
              if (d < -0.1 && grace) { vehicle.crash('saw'); return; }
            }
            break;
          }
          case 'pendulum': {
            const b = this.pendulumBob(h);
            if (Math.abs(pos.x - b.x) > h.r + 5) { this._nearMissPass(h, pos.x > h.px + h.len + 5); break; }
            for (const c of circles) {
              const d = Math.hypot(c.x - b.x, c.y - b.y) - h.r - c.r;
              if (d < h.minDist) h.minDist = d;
              if (d < -0.1 && grace) { vehicle.crash('blade'); return; }
            }
            break;
          }
          case 'boost':
            if (vehicle.onGround && pos.x > h.x0 && pos.x < h.x1 && pos.y < h.y + 2) {
              const a = vehicle.getAngle();
              const f = vehicle.totalMass * h.power;
              vehicle.chassis.applyForceToCenter(planck.Vec2(Math.cos(a) * f, Math.sin(a) * f), true);
              if (!h.active && this.onBoost) this.onBoost(h);
              h.active = true;
            } else h.active = false;
            break;
          case 'slow':
            if (vehicle.onGround && pos.x > h.x0 && pos.x < h.x1 && pos.y < h.y + 2) {
              const k = Math.pow(h.factor, dt * 30);
              for (const bd of [vehicle.chassis, vehicle.frontWheel, vehicle.rearWheel]) {
                const v = bd.getLinearVelocity();
                bd.setLinearVelocity(planck.Vec2(v.x * k, v.y * k));
              }
            }
            break;
          case 'bounce':
            h.cool = Math.max(0, h.cool - dt);
            if (h.cool === 0 && pos.x > h.x0 - 0.5 && pos.x < h.x1 + 0.5 && pos.y < h.y + 1.6 && pos.y > h.y - 0.5) {
              for (const bd of [vehicle.chassis, vehicle.frontWheel, vehicle.rearWheel]) {
                const v = bd.getLinearVelocity();
                bd.setLinearVelocity(planck.Vec2(Math.max(v.x, 10), h.power));
              }
              h.cool = 0.5;
              if (this.onBounce) this.onBounce(h);
            }
            break;
        }
      }

      // Finish line
      if (this.levelLength && !this._finishFired && pos.x >= this.finishX) {
        this._finishFired = true;
        if (this.onFinish) this.onFinish();
      }
    }

    _nearMissPass(h, passed) {
      if (!passed || h.passed) return;
      h.passed = true;
      if (h.minDist < 1.6 && h.minDist > -0.05 && this.onNearMiss) this.onNearMiss(h);
    }

    _updatePlatforms(dt, vehicle) {
      const t = this.time;
      for (const p of this.platforms) {
        const d = p.def;
        if (d.type === 'moving') {
          const w = 2 * Math.PI / d.period;
          const off = d.range * Math.sin(w * t), vel = d.range * w * Math.cos(w * t);
          if (d.axis === 'x') { p.body.setLinearVelocity(planck.Vec2(vel, 0)); }
          else { p.body.setLinearVelocity(planck.Vec2(0, vel)); }
          const bp = p.body.getPosition();
          // correct drift so the platform stays on its rail
          const tx = d.axis === 'x' ? d.cx + off : d.cx, ty = d.axis === 'y' ? d.cy + off : d.cy;
          if (Math.abs(bp.x - tx) + Math.abs(bp.y - ty) > 0.05) p.body.setTransform(planck.Vec2(tx, ty), 0);
          p.x = p.body.getPosition().x; p.y = p.body.getPosition().y;
        } else if (d.type === 'crumble') {
          if (!p.crumbled && p.timer < 0 && vehicle && !vehicle.crashed) {
            const vp = vehicle.getPosition();
            if (vp.x > d.cx - d.hw - 1 && vp.x < d.cx + d.hw && vp.y < d.cy + d.hh + 1.6 && vp.y > d.cy) p.timer = 0;
          }
          if (p.timer >= 0 && !p.crumbled) {
            p.timer += dt;
            p.shake = Math.min(1, p.timer / d.delay);
            if (p.timer >= d.delay) {
              p.crumbled = true;
              const f = p.body.getFixtureList();
              if (f) {
                f.setFilterData({ groupIndex: 0, categoryBits: this.pw.categories.TERRAIN, maskBits: 0 });
                const ud = f.getUserData(); ud.crumbled = true;
              }
              p.body.setType('dynamic');
              p.body.setAngularVelocity(0.6);
            }
          }
          const bp = p.body.getPosition();
          p.x = bp.x; p.y = bp.y; p.angle = p.body.getAngle();
        }
      }
    }

    destroy() {
      for (const b of this.bodies) this.pw.destroyBody(b.body);
      for (const p of this.platforms) this.pw.destroyBody(p.body);
      this.bodies = []; this.platforms = []; this.segments = [];
    }
  }

  root.Track = Track;
  root.TrackGenerator = Track;
  root.mulberry32 = mulberry32;
})(typeof window !== 'undefined' ? window : globalThis);
