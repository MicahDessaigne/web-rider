// js/vehicle.js
// Motorcycle: chassis box + 2 wheels on revolute joints (rear = motor) + head sensor.
// Crash rule: ONLY the head/helmet sensor touching active terrain (or a hazard / pit) ends the run.
// Chassis and wheels touching terrain never crash the bike.
(function (root) {
  const planck = root.planck;

  function angleDiff(a, b) {
    let d = a - b;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d;
  }
  function normAngle(a) { return angleDiff(a, 0); }

  class Vehicle {
    constructor(physicsWorld, startX, startY, track = null) {
      this.pw = physicsWorld;
      this.world = physicsWorld.getWorld();
      this.cats = physicsWorld.categories;
      this.track = track;

      this.chassis = null;
      this.frontWheel = null;
      this.rearWheel = null;
      this.headFixture = null;
      this.frontJoint = null;
      this.rearJoint = null;

      this.holding = false;
      this.stats = { torque: 1, spin: 1 }; // garage vehicle multipliers
      this.onGround = false;
      this.frontContact = 0;
      this.rearContact = 0;
      this.headContact = false;

      this.crashed = false;
      this.crashReason = '';
      this.age = 0;                 // simulated seconds since spawn (used for grace period)
      this.upsideDownTime = 0;

      this.totalRotation = 0;       // accumulated in-air rotation (radians, + = backflip/CCW)
      this.lastAngle = 0;
      this.wasAirborne = false;
      this.airTime = 0;
      this.groundTime = 0;
      this.landingAngle = 0;
      this.maxSpeed = 0;
      this.activeLoop = null;
      this.onLand = null;           // callback(data)
      this.onLoopComplete = null;   // callback(loop)

      this._create(startX, startY);
      this.lastAngle = this.chassis.getAngle();
      this._preSolve = (contact) => this._handlePreSolve(contact);
      this.pw.addPreSolve(this._preSolve);
    }

    setTrack(track) { this.track = track; }

    _create(x, y) {
      const w = this.world;
      const C = CONFIG;

      // ── Chassis ──
      this.chassis = w.createBody({
        type: 'dynamic',
        position: planck.Vec2(x, y),
        linearDamping: C.CHASSIS_LIN_DAMPING,
        angularDamping: C.CHASSIS_ANG_DAMPING,
        bullet: true,
      });
      this.chassisFixture = this.chassis.createFixture(planck.Box(C.CHASSIS_W / 2, C.CHASSIS_H / 2), Object.assign({
        density: C.CHASSIS_DENSITY,
        friction: C.CHASSIS_FRICTION,
        restitution: C.CHASSIS_RESTITUTION,
      }, this.pw.filterVehicle));
      this.chassisFixture.setUserData({ type: 'chassis', vehicle: this });

      // ── Head sensor (crash trigger) — zero density so it doesn't change the mass ──
      this.headFixture = this.chassis.createFixture(
        planck.Circle(planck.Vec2(C.HEAD_OFFSET_X, C.HEAD_OFFSET_Y), C.HEAD_RADIUS),
        Object.assign({ density: 0, isSensor: true }, this.pw.filterHead)
      );
      this.headFixture.setUserData({ type: 'head', vehicle: this });

      // ── Wheels (bullet = CCD → no tunnelling) ──
      const createWheel = (offsetX, type) => {
        const wb = w.createBody({
          type: 'dynamic',
          position: planck.Vec2(x + offsetX, y + C.WHEEL_Y_OFFSET),
          bullet: true,
          angularDamping: 0.05,
        });
        const f = wb.createFixture(planck.Circle(C.WHEEL_RADIUS), Object.assign({
          density: C.WHEEL_DENSITY,
          friction: C.WHEEL_FRICTION,
          restitution: C.WHEEL_RESTITUTION,
        }, this.pw.filterWheel));
        f.setUserData({ type, vehicle: this });
        wb.setUserData({ type, vehicle: this });
        return wb;
      };
      this.frontWheel = createWheel(C.FRONT_WHEEL_X, 'frontWheel');
      this.rearWheel = createWheel(C.REAR_WHEEL_X, 'rearWheel');
      this.chassis.setUserData({ type: 'chassis', vehicle: this });

      // ── Joints ──
      this.frontJoint = w.createJoint(planck.RevoluteJoint(
        { enableMotor: false },
        this.chassis, this.frontWheel,
        planck.Vec2(x + C.FRONT_WHEEL_X, y + C.WHEEL_Y_OFFSET)
      ));
      this.rearJoint = w.createJoint(planck.RevoluteJoint(
        { enableMotor: true, maxMotorTorque: C.MOTOR_BRAKE_TORQUE, motorSpeed: 0 },
        this.chassis, this.rearWheel,
        planck.Vec2(x + C.REAR_WHEEL_X, y + C.WHEEL_Y_OFFSET)
      ));

      // Effective rotational inertia of the whole bike about the chassis centre
      const mw = this.frontWheel.getMass();
      const d2f = C.FRONT_WHEEL_X * C.FRONT_WHEEL_X + C.WHEEL_Y_OFFSET * C.WHEEL_Y_OFFSET;
      const d2r = C.REAR_WHEEL_X * C.REAR_WHEEL_X + C.WHEEL_Y_OFFSET * C.WHEEL_Y_OFFSET;
      this.inertia = this.chassis.getInertia() + mw * (d2f + d2r) + this.frontWheel.getInertia() * 2;
      this.totalMass = this.chassis.getMass() + mw * 2;
    }

    // ── Loop handling: each loop has an entry half (A) and exit half (B) that overlap in 2D. ──
    _loopPartEnabled(ud) {
      if (!ud || ud.loop === undefined || !this.track) return true;
      const loop = this.track.loops[ud.loop];
      if (!loop) return true;
      return ud.part === loop.phase;
    }

    _terrainActive(fixture) {
      const ud = fixture.getUserData();
      if (!ud || !ud.terrain) return false;
      if (ud.crumbled) return false;
      return this._loopPartEnabled(ud);
    }

    _handlePreSolve(contact) {
      const fa = contact.getFixtureA(), fb = contact.getFixtureB();
      const ua = fa.getUserData(), ub = fb.getUserData();
      const mineA = ua && ua.vehicle === this, mineB = ub && ub.vehicle === this;
      if (!mineA && !mineB) return;
      const terrainFix = mineA ? fb : fa;
      const tu = terrainFix.getUserData();
      if (tu && tu.terrain && !this._loopPartEnabled(tu)) contact.setEnabled(false);
    }

    _countContacts(body, sensorFixture) {
      let n = 0;
      for (let ce = body.getContactList(); ce; ce = ce.next) {
        const c = ce.contact;
        if (!c.isTouching()) continue;
        const fa = c.getFixtureA(), fb = c.getFixtureB();
        let mine, other;
        if (fa.getBody() === body) { mine = fa; other = fb; } else { mine = fb; other = fa; }
        if (sensorFixture) {
          if (mine !== sensorFixture) continue;
        } else if (!c.isEnabled()) continue;
        if (this._terrainActive(other)) n++;
      }
      return n;
    }

    /** Called before every fixed physics step: motor, air torque, loop assist. */
    beforeStep(dt) {
      if (this.crashed) {
        this.rearJoint.setMotorSpeed(0);
        this.rearJoint.setMaxMotorTorque(CONFIG.MOTOR_BRAKE_TORQUE);
        return;
      }
      const C = CONFIG;
      const holding = this.holding;
      const vel = this.chassis.getLinearVelocity();
      const w = this.chassis.getAngularVelocity();

      if (holding) {
        this.rearJoint.setMotorSpeed(C.MOTOR_MAX_SPEED);
        this.rearJoint.setMaxMotorTorque((this.onGround ? C.MOTOR_MAX_TORQUE : C.MOTOR_MAX_TORQUE * 0.25) * this.stats.torque);
      } else {
        this.rearJoint.setMotorSpeed(0);
        this.rearJoint.setMaxMotorTorque(C.MOTOR_BRAKE_TORQUE);
      }

      if (this.onGround) {
        // Mild anti-wheelie: only rear wheel down while holding and nose lifting quickly
        if (holding && this.rearContact > 0 && this.frontContact === 0 && w > 0.5 && !this.activeLoop) {
          this.chassis.applyTorque(-C.ANTI_WHEELIE, true);
        }
      } else if (!this.activeLoop) {
        if (holding) {
          // Spin toward the target backflip speed (arcade, very responsive)
          const err = C.AIR_SPIN_SPEED * this.stats.spin - w;
          const torque = Math.max(-C.AIR_TORQUE, Math.min(C.AIR_TORQUE, err * this.inertia * 12));
          this.chassis.applyTorque(torque, true);
        } else {
          // Released: rotation calms down so the player can line up the landing
          const target = w * Math.max(0, 1 - C.AIR_RELEASE_DAMP * dt);
          this.chassis.applyTorque((target - w) * this.inertia / dt, true);
        }
      }

      // Loop magnet: cancel gravity + press the bike against the loop wall
      if (this.activeLoop && this.activeLoop.assist) {
        const L = this.activeLoop;
        const g = C.GRAVITY;
        for (const b of [this.chassis, this.frontWheel, this.rearWheel]) {
          const p = b.getPosition();
          let dx = p.x - L.cx, dy = p.y - L.cy;
          const d = Math.sqrt(dx * dx + dy * dy) || 1;
          dx /= d; dy /= d;
          const m = b.getMass();
          b.applyForceToCenter(planck.Vec2(m * dx * C.LOOP_STICK_ACCEL, m * (g + dy * C.LOOP_STICK_ACCEL)), true);
        }
        // Keep the bike moving through the loop
        const sp = Math.hypot(vel.x, vel.y);
        if (sp < C.LOOP_MIN_ENTRY_SPEED) {
          const p = this.chassis.getPosition();
          const rx = p.x - L.cx, ry = p.y - L.cy;
          const rl = Math.hypot(rx, ry) || 1;
          // tangent for counter-clockwise travel
          const tx = -ry / rl, ty = rx / rl;
          const boost = (C.LOOP_MIN_ENTRY_SPEED - sp) * this.totalMass * 4;
          this.chassis.applyForceToCenter(planck.Vec2(tx * boost, ty * boost), true);
        }
      }

      // Hard speed cap
      const sp = Math.hypot(vel.x, vel.y);
      if (sp > C.MAX_SPEED_MS) {
        const k = C.MAX_SPEED_MS / sp;
        for (const b of [this.chassis, this.frontWheel, this.rearWheel]) {
          const v = b.getLinearVelocity();
          b.setLinearVelocity(planck.Vec2(v.x * k, v.y * k));
        }
      }
    }

    /** Called after every fixed physics step: contacts, crash detection, stunt tracking. */
    afterStep(dt) {
      if (this.crashed) return;
      this.age += dt;
      const C = CONFIG;
      const pos = this.chassis.getPosition();
      const vel = this.chassis.getLinearVelocity();
      const angle = this.chassis.getAngle();
      const speed = Math.hypot(vel.x, vel.y);
      if (speed > this.maxSpeed) this.maxSpeed = speed;

      this.frontContact = this._countContacts(this.frontWheel);
      this.rearContact = this._countContacts(this.rearWheel);
      const chassisContact = this._countContacts(this.chassis);
      this.headContact = this._countContacts(this.chassis, this.headFixture) > 0;
      const grounded = this.frontContact > 0 || this.rearContact > 0;

      const graceOver = this.age * 1000 > C.CRASH_GRACE_MS;

      // ── CRASH: head sensor touched terrain ──
      if (this.headContact && graceOver) { this.crash('head'); return; }

      // Upside-down and stuck (lying on the chassis without the head touching)
      // (or standing on its tail): tilted > 100° relative to the ground beneath and not moving.
      let up = false;
      if (speed < 1.0 && !this.activeLoop && (grounded || chassisContact > 0)) {
        const slope = this.track && this.track.getGroundAngleAt ? this.track.getGroundAngleAt(pos.x, pos.y) : 0;
        up = Math.abs(normAngle(angle - slope)) > Math.PI * 0.55;
      }
      if (up) this.upsideDownTime += dt; else this.upsideDownTime = 0;
      if (this.upsideDownTime > 1.0 && this.age * 1000 > C.CRASH_GRACE_MS + 500) { this.crash('upside-down'); return; }

      // Fell out of the world
      const floor = this.track ? this.track.minY - 40 : -60;
      if (pos.y < floor) { this.crash('fell'); return; }

      this._updateLoops(pos, speed);

      // ── Air / ground state + rotation tracking ──
      if (grounded || this.activeLoop) {
        this.groundTime += dt;
        if (this.wasAirborne) {
          this.landingAngle = angle;
          this._land(pos);
        }
        this.wasAirborne = false;
        this.airTime = 0;
        this.totalRotation = 0;
      } else {
        if (!this.wasAirborne) {
          this.wasAirborne = true;
          this.totalRotation = 0;
          this.airTime = 0;
        }
        this.totalRotation += angleDiff(angle, this.lastAngle);
        this.airTime += dt;
        this.groundTime = 0;
      }
      this.onGround = grounded;
      this.lastAngle = angle;
    }

    _updateLoops(pos, speed) {
      if (!this.track || !this.track.loops) return;
      if (this.activeLoop) {
        const L = this.activeLoop;
        const phi = Math.atan2(pos.y - L.cy, pos.x - L.cx);
        L.acc += angleDiff(phi, L.prevPhi);
        L.prevPhi = phi;
        const dist = Math.hypot(pos.x - L.cx, pos.y - L.cy);
        if (!L.checked && L.acc > 0.25) {
          L.checked = true;
          L.assist = speed >= CONFIG.LOOP_MIN_ENTRY_SPEED * 0.9;
        }
        if (L.phase === 'A' && L.acc >= Math.PI) L.phase = 'B';
        if (L.acc >= Math.PI * 2 - 0.35 || (L.phase === 'B' && dist > L.r + 2.5)) {
          if (L.acc >= Math.PI * 2 - 0.35) {
            L.completed = true;
            if (this.onLoopComplete) this.onLoopComplete(L);
          }
          L.phase = 'B'; L.assist = false;
          this.activeLoop = null;
        } else if (L.phase === 'A' && (L.acc < -0.4 || dist > L.r + 2.5)) {
          L.assist = false; L.checked = false; L.acc = 0;
          this.activeLoop = null;
        }
        return;
      }
      for (const L of this.track.loops) {
        if (!L || L.phase !== 'A') continue;
        if (pos.x < L.cx || pos.x > L.cx + L.r) continue;
        if (pos.y > L.cy) continue;
        const dist = Math.hypot(pos.x - L.cx, pos.y - L.cy);
        if (dist > L.r + 1 || dist < L.r - 2.5) continue;
        L.acc = 0; L.prevPhi = Math.atan2(pos.y - L.cy, pos.x - L.cx);
        L.checked = false; L.assist = false;
        this.activeLoop = L;
        break;
      }
    }

    _land(pos) {
      let slope = 0;
      if (this.track && this.track.getGroundAngleAt) slope = this.track.getGroundAngleAt(pos.x, pos.y);
      const rel = normAngle(this.landingAngle - slope);
      const data = {
        totalRotation: this.totalRotation,
        airTime: this.airTime,
        landingAngle: this.landingAngle,
        relativeAngle: rel,
        x: pos.x, y: pos.y,
      };
      if (this.airTime > 0.12 && this.onLand) this.onLand(data);
      if (this.airTime > 0.12 && root.onVehicleLand && root.onVehicleLand !== this.onLand) root.onVehicleLand(data);
    }

    crash(reason) {
      if (this.crashed) return;
      this.crashed = true;
      this.crashReason = reason;
      this.activeLoop = null;
    }

    /** Legacy API: single call per frame (input + bookkeeping). Physics stepping happens in PhysicsWorld.step. */
    update(holding) { this.holding = !!holding; }

    /** Revive: reset the bike at a safe position. */
    respawn(x, y, angle = 0) {
      const C = CONFIG;
      const c = Math.cos(angle), s = Math.sin(angle);
      const place = (b, ox, oy) => {
        b.setTransform(planck.Vec2(x + ox * c - oy * s, y + ox * s + oy * c), angle);
        b.setLinearVelocity(planck.Vec2(0, 0));
        b.setAngularVelocity(0);
        b.setAwake(true);
      };
      place(this.chassis, 0, 0);
      place(this.frontWheel, C.FRONT_WHEEL_X, C.WHEEL_Y_OFFSET);
      place(this.rearWheel, C.REAR_WHEEL_X, C.WHEEL_Y_OFFSET);
      this.crashed = false; this.crashReason = '';
      this.age = 0; this.upsideDownTime = 0;
      this.wasAirborne = false; this.totalRotation = 0; this.airTime = 0;
      this.lastAngle = angle; this.activeLoop = null; this.headContact = false;
    }

    getPosition() { return this.chassis ? this.chassis.getPosition() : { x: 0, y: 0 }; }
    getAngle() { return this.chassis ? this.chassis.getAngle() : 0; }
    getVelocity() { return this.chassis ? this.chassis.getLinearVelocity() : { x: 0, y: 0 }; }
    getSpeed() { const v = this.getVelocity(); return Math.hypot(v.x, v.y); }
    getFrontWheelPos() { return this.frontWheel ? this.frontWheel.getPosition() : { x: 0, y: 0 }; }
    getRearWheelPos() { return this.rearWheel ? this.rearWheel.getPosition() : { x: 0, y: 0 }; }
    getFrontWheelAngle() { return this.frontWheel ? this.frontWheel.getAngle() : 0; }
    getRearWheelAngle() { return this.rearWheel ? this.rearWheel.getAngle() : 0; }
    getHeadPos() { return this.chassis.getWorldPoint(planck.Vec2(CONFIG.HEAD_OFFSET_X, CONFIG.HEAD_OFFSET_Y)); }
    getWorldPoint(lx, ly) { return this.chassis.getWorldPoint(planck.Vec2(lx, ly)); }
    /** Collision circles used for geometric hazard checks. */
    getHitCircles() {
      const R = CONFIG.WHEEL_RADIUS;
      return [
        { x: this.getFrontWheelPos().x, y: this.getFrontWheelPos().y, r: R },
        { x: this.getRearWheelPos().x, y: this.getRearWheelPos().y, r: R },
        Object.assign({ r: CONFIG.HEAD_RADIUS }, (() => { const h = this.getHeadPos(); return { x: h.x, y: h.y }; })()),
        { x: this.getPosition().x, y: this.getPosition().y, r: CONFIG.CHASSIS_H * 0.6 },
      ];
    }
    isOnGround() { return this.onGround; }
    isCrashed() { return this.crashed; }

    destroy() {
      if (this.world) {
        try {
          if (this.frontJoint) this.world.destroyJoint(this.frontJoint);
          if (this.rearJoint) this.world.destroyJoint(this.rearJoint);
          if (this.frontWheel) this.world.destroyBody(this.frontWheel);
          if (this.rearWheel) this.world.destroyBody(this.rearWheel);
          if (this.chassis) this.world.destroyBody(this.chassis);
        } catch (e) { /* world already gone */ }
      }
      const i = this.pw.preSolveHandlers.indexOf(this._preSolve);
      if (i >= 0) this.pw.preSolveHandlers.splice(i, 1);
      this.chassis = this.frontWheel = this.rearWheel = null;
    }
  }

  root.Vehicle = Vehicle;
  root.angleDiff = angleDiff;
})(typeof window !== 'undefined' ? window : globalThis);
