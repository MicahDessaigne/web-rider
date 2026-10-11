// js/track-pieces.js — 100 obstacle piece definitions.
//
// Every piece is built in LOCAL space starting at (0,0) with a flat (0°) entry and ends with a flat exit.
// A piece exposes:
//   name, difficulty (1-10), minSpeed, maxSpeed, length, entryAngle, exitAngle, exitHeight,
//   gems: [{x,y}] (local), hazards: [...] (local),
//   getPoints(sx, sy)  → ground polyline (world space). A point with gap:true starts a new segment.
//   build(sx, sy)      → full geometry {segs, gems, hazards, loops, platforms, exit}
//
// Segment kinds: 'ground' (filled to bottom), 'bridge' (thin filled slab under the line),
// 'loopA'/'loopB' (two halves of a loop — only one is solid at a time), 'island'/'ceiling' (closed slabs).
(function (root) {
  const D2R = Math.PI / 180;
  const G = () => (root.CONFIG ? root.CONFIG.GRAVITY : 30);
  const V_DESIGN = 18.5;   // conservative design speed (m/s) at jump lips

  function arcPoints(cx, cy, r, startDeg, endDeg, n = 32) {
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const a = (startDeg + (endDeg - startDeg) * i / n) * D2R;
      pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
    }
    return pts;
  }

  // Catmull-Rom smoothing of a control polyline
  function curvePoints(points, tension = 0.5, segments = 8) {
    if (points.length < 3) return points.slice();
    const out = [points[0]];
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[Math.max(0, i - 1)], p1 = points[i], p2 = points[i + 1], p3 = points[Math.min(points.length - 1, i + 2)];
      for (let s = 1; s <= segments; s++) {
        const t = s / segments, t2 = t * t, t3 = t2 * t;
        const m1x = (p2.x - p0.x) * tension, m1y = (p2.y - p0.y) * tension;
        const m2x = (p3.x - p1.x) * tension, m2y = (p3.y - p1.y) * tension;
        out.push({
          x: (2 * t3 - 3 * t2 + 1) * p1.x + (t3 - 2 * t2 + t) * m1x + (-2 * t3 + 3 * t2) * p2.x + (t3 - t2) * m2x,
          y: (2 * t3 - 3 * t2 + 1) * p1.y + (t3 - 2 * t2 + t) * m1y + (-2 * t3 + 3 * t2) * p2.y + (t3 - t2) * m2y,
        });
      }
    }
    return out;
  }

  /** Flight range for a launch at angle (deg) with speed v landing dy above the lip. */
  function flightRange(v, deg, dy) {
    const g = G();
    const vx = v * Math.cos(deg * D2R), vy = v * Math.sin(deg * D2R);
    const disc = vy * vy - 2 * g * dy;
    if (disc < 0) return 0;
    return vx * (vy + Math.sqrt(disc)) / g;
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Path builder ("turtle") producing smooth terrain
  // ────────────────────────────────────────────────────────────────────────────
  class PB {
    constructor() {
      this.segs = []; this.gems = []; this.hazards = []; this.loops = []; this.platforms = [];
      this.h = 0; // heading in degrees
      this._open({ x: 0, y: 0 }, 'ground');
    }
    _open(p, kind, extra = {}) {
      this.cur = Object.assign({ kind, pts: [{ x: p.x, y: p.y }] }, extra);
      this.segs.push(this.cur);
      return this;
    }
    last() { return this.cur.pts[this.cur.pts.length - 1]; }
    get x() { return this.last().x; }
    get y() { return this.last().y; }
    to(x, y) {
      const l = this.last();
      if (Math.hypot(x - l.x, y - l.y) > 0.03) this.cur.pts.push({ x, y });
      return this;
    }
    flat(len, step = 2) {
      const n = Math.max(1, Math.ceil(len / step)), x0 = this.x, y0 = this.y;
      for (let i = 1; i <= n; i++) this.to(x0 + len * i / n, y0);
      this.h = 0; return this;
    }
    straight(len, step = 1.5) {
      const n = Math.max(1, Math.ceil(len / step)), x0 = this.x, y0 = this.y;
      const c = Math.cos(this.h * D2R), s = Math.sin(this.h * D2R);
      for (let i = 1; i <= n; i++) this.to(x0 + c * len * i / n, y0 + s * len * i / n);
      return this;
    }
    /** Cosine ease: zero slope at both ends. */
    ease(len, dh, n) {
      n = n || Math.max(6, Math.ceil(len / 0.6));
      const x0 = this.x, y0 = this.y;
      for (let i = 1; i <= n; i++) {
        const t = i / n;
        this.to(x0 + len * t, y0 + dh * (1 - Math.cos(Math.PI * t)) / 2);
      }
      this.h = 0; return this;
    }
    /** Repeated (1-cos) bumps of height amp (amp<0 → dips). */
    bumps(len, amp, count) {
      const n = Math.max(12, Math.ceil(len / 0.5)), x0 = this.x, y0 = this.y;
      for (let i = 1; i <= n; i++) {
        const t = i / n;
        this.to(x0 + len * t, y0 + amp * (1 - Math.cos(2 * Math.PI * count * t)) / 2);
      }
      this.h = 0; return this;
    }
    /** Circular turn from the current heading to heading h1 (degrees) with radius R. */
    turn(R, h1) {
      const h0 = this.h, p = this.last();
      const n = Math.max(4, Math.ceil(Math.abs(h1 - h0) / 4));
      const left = h1 > h0;
      const s0 = Math.sin(h0 * D2R), c0 = Math.cos(h0 * D2R);
      const cx = left ? p.x - R * s0 : p.x + R * s0;
      const cy = left ? p.y + R * c0 : p.y - R * c0;
      for (let i = 1; i <= n; i++) {
        const h = (h0 + (h1 - h0) * i / n) * D2R;
        if (left) this.to(cx + R * Math.sin(h), cy - R * Math.cos(h));
        else this.to(cx - R * Math.sin(h), cy + R * Math.cos(h));
      }
      this.h = h1; return this;
    }
    /** Concave kicker: from flat, curve up to `deg` over horizontal length kl. Returns lip height. */
    kicker(kl, deg) {
      const R = kl / Math.sin(deg * D2R);
      const y0 = this.y;
      this.turn(R, deg);
      return this.y - y0;
    }
    /** Quadratic Bézier from current point (current heading) to (x2,y2) with end slope s1. */
    bez(x2, y2, s1 = 0, n) {
      const p0 = this.last();
      const s0 = Math.tan(this.h * D2R);
      // control point = intersection of tangent lines
      let cx, cy;
      if (Math.abs(s0 - s1) < 1e-4) { cx = (p0.x + x2) / 2; cy = (p0.y + y2) / 2; }
      else {
        cx = (y2 - p0.y + s0 * p0.x - s1 * x2) / (s0 - s1);
        cx = Math.max(p0.x + 0.05, Math.min(x2 - 0.05, cx));
        cy = p0.y + s0 * (cx - p0.x);
      }
      n = n || Math.max(10, Math.ceil((x2 - p0.x) / 0.6));
      for (let i = 1; i <= n; i++) {
        const t = i / n, a = (1 - t) * (1 - t), b = 2 * (1 - t) * t, c = t * t;
        this.to(a * p0.x + b * cx + c * x2, a * p0.y + b * cy + c * y2);
      }
      this.h = Math.atan(s1) / D2R; return this;
    }
    /** Landing slope: from the current point descend by `drop` over `len` (smooth, zero end slopes). */
    landing(len, drop) { return this.ease(len, -drop); }
    /** Gap: wall down at the lip, pit, wall up to the landing at relative height dy. */
    gap(len, dy = 0, wall = 10) {
      const x0 = this.x, y0 = this.y;
      this.to(x0 + 0.08, y0 - wall);
      const ly = y0 + dy;
      this.hazards.push({ type: 'pit', x0: x0, x1: x0 + len, y: Math.min(y0, ly) - (root.CONFIG ? root.CONFIG.PIT_KILL_DEPTH : 7) });
      this._open({ x: x0 + len - 0.08, y: ly - wall }, 'ground');
      this.to(x0 + len, ly);
      this.h = 0; return this;
    }
    /** Launch over a gap: kicker sized so the gap is clearable at design speed. */
    jumpGap(gapLen, dy = 0, opts = {}) {
      const kl = opts.kl || Math.max(3.5, Math.min(6, gapLen * 0.3));
      let deg = opts.deg || 14;
      if (!opts.deg) {
        // Lip speed from energy conservation at the (conservative) design approach speed.
        // Measured in the harness: the real bike arrives at ~21.5 m/s and loses extra energy in the
        // concave transition, which this conservative estimate matches well.
        for (deg = 14; deg <= 45; deg += 1) {
          const hk = kl * Math.tan(deg * D2R / 2);
          const vLip = Math.sqrt(Math.max(1, V_DESIGN * V_DESIGN - 2 * G() * hk));
          if (flightRange(vLip * 0.92, deg, dy - hk) >= gapLen * 1.2 + 2.5) break;
        }
      }
      const lipX = this.x, y0 = this.y;
      const hk = this.kicker(kl, deg);
      const lip = { x: this.x, y: this.y, deg };
      if (opts.gems) this.trajGems(lip.x, lip.y, deg, opts.gems, gapLen / opts.gems);
      this.gap(gapLen, (y0 + dy) - this.y);
      if (opts.spikes) this.hazards.push({ type: 'spike', x: lip.x + 1, y: lip.y - 9.5, w: gapLen - 2, h: 1.2, pit: true });
      return lip;
    }
    /** Ramp with smooth landing (no gap). */
    rampJump(kl, deg, landLen, landDrop = 0, plateau = 0.6) {
      const y0 = this.y;
      const hk = this.kicker(kl, deg);
      this.h = 0; // sharp lip → flat plateau (convex corner is fine)
      this.flat(plateau, plateau);
      this.landing(landLen, hk + landDrop);
      return { h: hk, base: y0 };
    }
    /** Cliff drop with a ballistic-style landing transition. */
    drop(h, v = V_DESIGN) {
      const x0 = this.x, y0 = this.y;
      this.to(x0 + 0.3, y0 - h * 0.45);
      this.h = -Math.atan(h * 0.45 / 0.3) / D2R;
      const L = Math.max(6, v * Math.sqrt(2 * h / G()) * 1.25);
      this.h = -70;
      this.bez(x0 + L, y0 - h, 0);
      return this;
    }
    loop(r, lead = 3) {
      const y0 = this.y;
      this.flat(r + lead, 1.5);
      const cx = this.x, cy = y0 + r;
      const li = this.loops.length;
      this.loops.push({ cx, cy, r });
      const n = Math.max(24, Math.round(r * 9));
      this._open({ x: cx, y: y0 }, 'loopA', { loop: li, part: 'A' });
      for (let i = 1; i <= n; i++) { const a = (-90 + 180 * i / n) * D2R; this.to(cx + r * Math.cos(a), cy + r * Math.sin(a)); }
      const top = this.last();
      this._open({ x: top.x, y: top.y }, 'loopB', { loop: li, part: 'B' });
      for (let i = 1; i <= n; i++) { const a = (90 + 180 * i / n) * D2R; this.to(cx + r * Math.cos(a), cy + r * Math.sin(a)); }
      this.to(cx, y0);
      this._open({ x: cx, y: y0 }, 'ground');
      this.h = 0;
      this.flat(r + lead, 1.5);
      this.gem(cx, cy + r - 0.75);
      this.gem(cx + r - 0.75, cy);
      this.gem(cx - r + 0.75, cy);
      return { cx, cy };
    }
    island(x0, top, len, thick = 1.5, kind = 'island') {
      const pts = [{ x: x0, y: top - thick }, { x: x0, y: top }];
      const n = Math.max(1, Math.ceil(len / 2));
      for (let i = 1; i <= n; i++) pts.push({ x: x0 + len * i / n, y: top });
      pts.push({ x: x0 + len, y: top - thick });
      for (let i = n - 1; i >= 1; i--) pts.push({ x: x0 + len * i / n, y: top - thick });
      this.segs.push({ kind, pts, closed: true });
      return this;
    }
    /** Switch the current line to a bridge style (thin slab instead of solid ground). */
    bridge(len, thick = 1, arch = 0) {
      const p = this.last();
      this._open(p, 'bridge', { thick });
      if (arch) this.ease(len / 2, arch).ease(len / 2, -arch); else this.flat(len, 2);
      const q = this.last();
      this._open(q, 'ground');
      return this;
    }
    gem(x, y) { this.gems.push({ x, y }); return this; }
    gemLine(x0, x1, y, n) { for (let i = 0; i < n; i++) this.gem(x0 + (x1 - x0) * (n === 1 ? 0.5 : i / (n - 1)), y); return this; }
    /** Gems along the expected ballistic path from a lip. */
    trajGems(lx, ly, deg, count, spacing, v = V_DESIGN, lift = 0.75) {
      const g = G(), vx = v * Math.cos(deg * D2R), vy = v * Math.sin(deg * D2R);
      for (let i = 1; i <= count; i++) {
        const dx = i * spacing, t = dx / vx;
        this.gem(lx + dx, ly + lift + vy * t - 0.5 * g * t * t);
      }
      return this;
    }
    hz(o) { this.hazards.push(o); return this; }
    plat(o) { this.platforms.push(o); return this; }
    done() {
      return { segs: this.segs, gems: this.gems, hazards: this.hazards, loops: this.loops, platforms: this.platforms, exit: { x: this.x, y: this.y } };
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Piece factory
  // ────────────────────────────────────────────────────────────────────────────
  function translateHazard(h, sx, sy) {
    const o = Object.assign({}, h);
    for (const k of ['x', 'x0', 'x1', 'px', 'cx']) if (typeof o[k] === 'number') o[k] += sx;
    for (const k of ['y', 'py', 'cy', 'y0', 'y1', 'top']) if (typeof o[k] === 'number') o[k] += sy;
    return o;
  }

  function makePiece(name, difficulty, minSpeed, buildFn, extra = {}) {
    const geo = buildFn(new PB());
    const lastGround = geo.segs.filter(s => s.kind === 'ground' || s.kind === 'bridge');
    const piece = {
      name, difficulty, minSpeed,
      maxSpeed: extra.maxSpeed || 35,
      length: geo.exit.x,
      entryAngle: 0,
      exitAngle: 0,
      exitHeight: geo.exit.y,
      gems: geo.gems,
      hazards: geo.hazards,
      calm: !!extra.calm,
      tags: extra.tags || [],
      getPoints(sx = 0, sy = 0) {
        const out = [];
        let prevEnd = null;
        for (const s of lastGround) {
          s.pts.forEach((p, i) => {
            const q = { x: sx + p.x, y: sy + p.y };
            if (i === 0) {
              if (prevEnd && Math.hypot(prevEnd.x - p.x, prevEnd.y - p.y) < 1e-6) return;
              if (prevEnd) q.gap = true;
            }
            out.push(q);
          });
          prevEnd = s.pts[s.pts.length - 1];
        }
        return out;
      },
      build(sx = 0, sy = 0) {
        return {
          segs: geo.segs.map(s => Object.assign({}, s, { pts: s.pts.map(p => ({ x: sx + p.x, y: sy + p.y })) })),
          gems: geo.gems.map(g => ({ x: sx + g.x, y: sy + g.y })),
          hazards: geo.hazards.map(h => translateHazard(h, sx, sy)),
          loops: geo.loops.map(l => ({ cx: sx + l.cx, cy: sy + l.cy, r: l.r })),
          platforms: geo.platforms.map(p => translateHazard(p, sx, sy)),
          exit: { x: sx + geo.exit.x, y: sy + geo.exit.y },
        };
      },
    };
    return piece;
  }

  // ────────────────────────────────────────────────────────────────────────────
  // CATEGORY 1: Flats and gentle terrain
  // ────────────────────────────────────────────────────────────────────────────
  const flat = (len, h = 0) => makePiece(`Flat ${len}m`, 1, 0, P => { P.flat(len); if (h) P.ease(10, h); return P.done(); }, { calm: true });
  const flatWithGems = (len, n) => makePiece('Flat + gems', 1, 0, P => { P.flat(len); P.gemLine(4, len - 4, 1.1, n); return P.done(); }, { calm: true });
  const gentleUphill = (len, h) => makePiece('Gentle rise', 1, 0, P => { P.flat(3); P.ease(len, h); P.flat(4); P.gemLine(3 + len * 0.3, 3 + len * 0.7, h / 2 + 1.1, 3); return P.done(); }, { calm: true });
  const gentleDownhill = (len, h) => makePiece('Gentle drop', 1, 0, P => { P.flat(3); P.ease(len, h); P.flat(4); return P.done(); }, { calm: true });
  const smallBump = (len, h) => makePiece('Speed bump', 2, 0, P => { P.flat(3); P.bumps(len, h, 1); P.flat(3); P.gem(3 + len / 2, h + 1.6); return P.done(); }, { calm: true });
  const mediumBump = (len, h) => makePiece('Medium bump', 3, 0, P => { P.flat(3); P.bumps(len, h, 1); P.flat(6); P.gem(3 + len / 2, h + 2.2); return P.done(); });
  const washboard = (len, h, n) => makePiece(`Washboard x${n}`, n > 4 ? 3 : 2, 0, P => { P.flat(3); P.bumps(len, h, n); P.flat(4); return P.done(); });
  const gentleSCurve = (len, a) => makePiece('S-curve', 2, 0, P => { P.flat(3); P.ease(len / 4, a); P.ease(len / 2, -2 * a); P.ease(len / 4, a); P.flat(3); return P.done(); }, { calm: true });
  const valleyDip = (len, d) => makePiece('Valley dip', 1, 0, P => { P.flat(3); P.ease(len / 2, d); P.ease(len / 2, -d); P.flat(3); P.gem(3 + len / 2, d + 1.1); return P.done(); }, { calm: true });

  // ────────────────────────────────────────────────────────────────────────────
  // CATEGORY 2: Ramps and kickers
  // ────────────────────────────────────────────────────────────────────────────
  const ramp = (len, deg) => makePiece(`Ramp ${deg}°`, Math.min(9, 2 + Math.round(deg / 10)), 10, P => {
    P.flat(4);
    const kl = Math.max(2.5, len * 0.3);
    const r = P.rampJump(kl, deg, len * 0.9 + deg * 0.25, 0);
    P.flat(5);
    P.trajGems(4 + kl, r.h, deg, 3, 3);
    return P.done();
  });
  const doubleKicker = (len, h1, h2) => makePiece('Double kicker', 4, 10, P => {
    P.flat(3);
    P.rampJump(3, 20 + h1 * 4, len * 0.35, 0);
    P.flat(3);
    P.rampJump(3.5, 20 + h2 * 4, len * 0.45, 0);
    P.flat(4);
    return P.done();
  });
  const tripleKicker = (len, h1, h2) => makePiece('Triple kicker', 5, 10, P => {
    P.flat(3);
    for (let i = 0; i < 3; i++) { P.rampJump(2.5, 18 + (i === 1 ? h2 : h1) * 5, len / 4, 0); P.flat(2); }
    P.flat(3);
    return P.done();
  });
  const stepUp = (len, h) => makePiece(`Step up ${h}m`, h > 4 ? 4 : 3, 12, P => {
    P.flat(3); P.ease(Math.max(8, len * 0.45), h); P.flat(len * 0.35); P.gem(P.x - 3, P.y + 1.1);
    return P.done();
  });
  const tabletop = (len, h) => makePiece('Tabletop', 4, 12, P => {
    P.flat(3); P.ease(len * 0.3, h); P.flat(len * 0.3); P.gemLine(3 + len * 0.3, 3 + len * 0.6, h + 1.1, 4); P.ease(len * 0.4, -h); P.flat(3);
    return P.done();
  });
  const reverseRamp = (len, deg) => makePiece('Downhill run', 3, 0, P => {
    const L = len * 0.75; const h = Math.min(8, Math.tan(Math.min(deg, 40) * D2R) * 2 * L / Math.PI);
    P.flat(3); P.ease(L, -h); P.flat(len * 0.25);
    return P.done();
  });

  // ────────────────────────────────────────────────────────────────────────────
  // CATEGORY 3: Gap jumps
  // ────────────────────────────────────────────────────────────────────────────
  const gapJump = (gap, dy, _) => makePiece(`Gap ${gap}m`, Math.min(9, 3 + Math.round(gap / 4) + (dy > 0 ? 1 : 0)), 14, P => {
    P.flat(5);
    P.jumpGap(gap, dy);
    P.landing(12, 1.2); P.flat(4);
    return P.done();
  });
  const doubleGap = (len, gap, dy) => makePiece('Double gap', 6, 15, P => {
    P.flat(5);
    P.jumpGap(gap, -0.5);
    P.landing(6, 0.4); P.flat(3);
    P.jumpGap(gap, -0.5);
    P.landing(10, 1); P.flat(4);
    return P.done();
  });
  const gapWithHazard = (gap, kind) => makePiece('Spike gap', 6, 15, P => {
    P.flat(5); P.jumpGap(gap, -1, { spikes: true }); P.landing(10, 1); P.flat(4);
    return P.done();
  });
  const chasms = (len, dy) => makePiece('Chasm', 8, 17, P => {
    P.flat(6); P.jumpGap(len * 0.6, dy); P.landing(14, 2); P.flat(4);
    return P.done();
  });
  const gapWithGemArc = (gap, n) => makePiece('Gem gap', 5, 14, P => {
    P.flat(5); P.jumpGap(gap, -1, { gems: Math.max(3, n) }); P.landing(10, 1); P.flat(4);
    return P.done();
  });

  // ────────────────────────────────────────────────────────────────────────────
  // CATEGORY 4: Drops and cliffs
  // ────────────────────────────────────────────────────────────────────────────
  const drop = (len, h) => makePiece(`Drop ${h}m`, Math.min(8, 2 + Math.round(h / 2)), 0, P => {
    P.flat(Math.max(4, len * 0.3)); P.drop(h); P.flat(5);
    return P.done();
  });
  const cliffToValley = (len, d) => makePiece('Cliff to valley', 5, 0, P => {
    P.flat(4); P.drop(-d); P.flat(3); P.ease(len * 0.6, -d * 0.4); P.flat(4);
    return P.done();
  });
  const steppedDrops = (len, step, n) => makePiece(`Stepped drops x${n}`, 4, 0, P => {
    P.flat(3); for (let i = 0; i < n; i++) { P.drop(step); P.flat(len / n * 0.25); } P.flat(3);
    return P.done();
  });
  const dropIntoLoop = (len, h) => makePiece('Drop into loop', 7, 10, P => {
    P.flat(4); P.drop(h); P.flat(2); P.loop(4.5); P.flat(3);
    return P.done();
  }, { tags: ['loop'] });
  const dropWithBounce = (len, h) => makePiece('Drop + bounce', 6, 0, P => {
    P.flat(4); P.drop(h); P.flat(2);
    const bx = P.x; P.flat(4); P.hz({ type: 'bounce', x0: bx, x1: bx + 4, y: P.y, power: 15 });
    P.flat(6); P.landing(16, 1.5); P.flat(3);
    return P.done();
  });

  // ────────────────────────────────────────────────────────────────────────────
  // CATEGORY 5: Loops
  // ────────────────────────────────────────────────────────────────────────────
  const loop = (r) => makePiece(`Loop r=${r}m`, r < 4 ? 6 : r < 6 ? 7 : 9, Math.sqrt(G() * r) * 0.6, P => {
    P.flat(4); P.loop(r); P.flat(3); return P.done();
  }, { tags: ['loop'] });
  const loopWithRamp = (r) => makePiece('Loop + approach', 7, 10, P => {
    P.flat(3); P.ease(10, -2.5); P.loop(r); P.flat(3); return P.done();
  }, { tags: ['loop'] });
  const loopThenGap = (r, gap) => makePiece('Loop then gap', 8, 14, P => {
    P.flat(4); P.loop(r); P.flat(4); P.jumpGap(gap, -1); P.landing(10, 1); P.flat(3); return P.done();
  }, { tags: ['loop'] });
  const doubleLoop = (r1, r2) => makePiece('Double loop', 8, 12, P => {
    P.flat(4); P.loop(r1); P.loop(r2, 4); P.flat(3); return P.done();
  }, { tags: ['loop'] });
  const halfLoop = (r) => makePiece('Half-loop launch', 6, 12, P => {
    P.flat(4); P.rampJump(r * 0.7, 50, 18, 0); P.flat(4); return P.done();
  });
  const loopThenDrop = (r, h) => makePiece('Loop then drop', 8, 12, P => {
    P.flat(4); P.loop(r); P.flat(3); P.drop(h); P.flat(4); return P.done();
  }, { tags: ['loop'] });

  // ────────────────────────────────────────────────────────────────────────────
  // CATEGORY 6: Half-pipes, curves, bowls
  // ────────────────────────────────────────────────────────────────────────────
  const quarterPipeRight = (len, h) => makePiece('Quarter pipe up', 4, 12, P => {
    P.flat(3); P.ease(len, h); P.flat(4); return P.done();
  });
  const quarterPipeLeft = (len, h) => makePiece('Quarter pipe down', 3, 0, P => {
    P.flat(3); P.ease(len, h); P.flat(4); return P.done();
  });
  const halfPipe = (len, h) => makePiece('Half-pipe', 4, 8, P => {
    P.flat(3); P.ease(len * 0.35, -h); P.flat(len * 0.3); P.gem(P.x - len * 0.15, P.y + 1.1); P.ease(len * 0.35, h); P.flat(4); return P.done();
  });
  const bowl = (len, d) => makePiece('Bowl', 3, 6, P => {
    P.flat(3); P.ease(len / 2, -d); P.ease(len / 2, d); P.flat(3); return P.done();
  });
  const bankedTurn = (len, h) => makePiece('Banked hump', 3, 8, P => {
    P.flat(3); P.ease(len * 0.35, h); P.flat(len * 0.3); P.ease(len * 0.35, -h); P.flat(3); return P.done();
  });
  const sCurveWide = (len, a) => makePiece('Wide S-curve', 3, 0, P => {
    P.flat(3); P.ease(len / 4, a); P.ease(len / 2, -2 * a); P.ease(len / 4, a); P.flat(3); return P.done();
  });
  const waveSection = (len, a, n) => makePiece(`Waves x${n}`, 4, 8, P => {
    P.flat(3); P.bumps(len, a, n); P.flat(3);
    for (let i = 0; i < n; i++) P.gem(3 + (i + 0.5) * len / n, a + 1.3);
    return P.done();
  });
  const rollerCoaster = (len, a, n) => makePiece('Roller coaster', 5, 10, P => {
    P.flat(3); P.ease(6, -a / 2); P.bumps(len, a, n); P.ease(6, a / 2); P.flat(3); return P.done();
  });

  // ────────────────────────────────────────────────────────────────────────────
  // CATEGORY 7: Platforms and bridges
  // ────────────────────────────────────────────────────────────────────────────
  const floatingPlatform = (len, h, thick) => makePiece(`Floating platform ${len}m`, len > 15 ? 5 : 6, 15, P => {
    P.flat(3); P.ease(10, h - 1); P.flat(3);
    const lip = P.jumpGap(5, 0.4);
    // the landing segment after jumpGap is the platform top; make it a slab by closing it with walls
    P.flat(len);
    P.to(P.x + 0.08, P.y - thick);
    const top = P.y + thick;
    const x1 = P.x;
    P.hz({ type: 'pit', x0: x1, x1: x1 + 7, y: top - h - 7 });
    P._open({ x: x1 + 7 - 0.08, y: top - h + 1 - 10 }, 'ground');
    P.to(x1 + 7, top - h + 1);
    P.h = 0; P.landing(10, 1); P.flat(3);
    P.gemLine(lip.x + 6, lip.x + 4 + len, top + 1.1, Math.max(2, Math.round(len / 4)));
    return P.done();
  });
  const narrowBridge = (len, depth, thick) => makePiece('Narrow bridge', 3, 5, P => {
    P.flat(4); P.bridge(len, 0.5 * thick); P.flat(4); P.gemLine(5, 3 + len, 1.1, 4); return P.done();
  }, { calm: true });
  const tunnel = (len, ceil, thick) => makePiece('Tunnel', 4, 0, P => {
    P.flat(6); const x0 = P.x, y0 = P.y; P.flat(len); P.island(x0, y0 + ceil + thick, len, thick, 'ceiling');
    P.gemLine(x0 + 2, x0 + len - 2, y0 + 1.1, 5); P.flat(6); return P.done();
  });
  const stairsUp = (len, sh, n) => makePiece(`Stairs up x${n}`, 5, 12, P => {
    P.flat(3); for (let i = 0; i < n; i++) { P.ease(len / n * 0.5, sh); P.flat(len / n * 0.5); } P.flat(3); return P.done();
  });
  const stairsDown = (len, sh, n) => makePiece(`Stairs down x${n}`, 3, 0, P => {
    P.flat(3); for (let i = 0; i < n; i++) { P.ease(len / n * 0.4, -sh); P.flat(len / n * 0.6); } P.flat(3); return P.done();
  });
  const multiPlatforms = (len, count, h) => makePiece('Platform hop', 7, 15, P => {
    P.flat(3); P.ease(10, h); P.flat(3);
    const lipX = P.x; const lipY = P.y;
    P.kicker(3, 22);
    let x = P.x, top = lipY;
    P.to(x + 0.08, P.y - 10);
    const gapL = 4.5, platL = (len - count * gapL) / count;
    const startX = x;
    for (let i = 0; i < count; i++) {
      x += gapL; top -= 0.7;
      P.island(x, top, platL, 1.2);
      x += platL;
    }
    x += gapL;
    P.hz({ type: 'pit', x0: startX, x1: x, y: Math.min(top, lipY - h) - 7 });
    const landY = lipY - h;
    P._open({ x: x - 0.08, y: landY - 10 }, 'ground'); P.to(x, landY); P.h = 0;
    P.landing(10, 0.5); P.flat(3);
    return P.done();
  });
  const wideBridge = (len, arch, thick) => makePiece('Arched bridge', 2, 5, P => {
    P.flat(4); P.bridge(len, thick * 0.5, arch); P.flat(4); P.gem(4 + len / 2, arch + 1.2); return P.done();
  }, { calm: true });

  // ────────────────────────────────────────────────────────────────────────────
  // CATEGORY 8: Hazards
  // ────────────────────────────────────────────────────────────────────────────
  const hazardBlock = (len, h, count) => makePiece(`Spike blocks x${count}`, 4 + count, 15, P => {
    P.flat(4);
    for (let i = 0; i < count; i++) {
      const r = P.kicker(2.5, 24); P.h = 0; const lipX = P.x;
      P.flat(0.5, 0.5); P.ease(3, -r);
      P.hz({ type: 'spike', x: lipX + 2.5, y: P.y, w: 3.2, h: 0.9 });
      P.flat(len / count - 3);
    }
    P.flat(3);
    return P.done();
  });
  const spikedGap = (gap) => makePiece('Spike pit', 6, 15, P => {
    P.flat(5); P.jumpGap(gap, 0, { spikes: true }); P.landing(10, 1); P.flat(3); return P.done();
  });
  const rotSaw = (len, h, r) => makePiece('Rotating saw', 7, 15, P => {
    P.flat(5); const gap = len * 0.6; const lip = P.jumpGap(gap, -1);
    // Saw sits in the pit just below the flight path: clear it or get shredded
    P.hz({ type: 'saw', x: lip.x + gap * 0.5, y: lip.y - 1.0, r: r * 0.7, speed: 3 });
    P.landing(10, 1); P.flat(3); return P.done();
  });
  const swingPendulum = (len, rope, r) => makePiece('Swinging blade', 7, 0, P => {
    P.flat(6); const x0 = P.x, y0 = P.y; P.flat(len);
    P.hz({ type: 'pendulum', px: x0 + len / 2, py: y0 + rope + 3.3, len: rope, r: r * 0.35, amp: 1.0, period: 2.2 });
    P.flat(4); return P.done();
  });
  const speedBoost = (len) => makePiece('Speed boost', 2, 0, P => {
    P.flat(3); const x0 = P.x; P.flat(len); P.hz({ type: 'boost', x0, x1: x0 + len, y: P.y, power: 28 }); P.gemLine(x0 + 2, x0 + len - 2, 1.1, 4); P.flat(4); return P.done();
  }, { calm: true });
  const slowZone = (len) => makePiece('Slow zone', 2, 0, P => {
    P.flat(3); const x0 = P.x; P.flat(len); P.hz({ type: 'slow', x0, x1: x0 + len, y: P.y, factor: 0.985 }); P.flat(4); return P.done();
  }, { calm: true });
  const bouncePad = (len, power) => makePiece('Bounce pad', 4, 0, P => {
    P.flat(4); const x0 = P.x; P.flat(3); P.hz({ type: 'bounce', x0, x1: x0 + 3, y: P.y, power: Math.sqrt(2 * G() * power) });
    P.flat(len); P.landing(14, 1.5); P.flat(3);
    P.gem(x0 + 8, power * 0.8); return P.done();
  });
  const movingPlatformH = (len, range, period) => makePiece('Sliding platform', 7, 15, P => {
    P.flat(5); const gap = len * 0.6; const lip = P.jumpGap(gap, -1, { deg: 24 });
    // a kinematic platform slides inside the gap just below lip height
    P.plat({ type: 'moving', axis: 'x', cx: lip.x + gap / 2, cy: lip.y - 0.6, hw: gap * 0.35, hh: 0.3, range: Math.min(range, gap * 0.12), period });
    P.landing(10, 1); P.flat(3); return P.done();
  });
  const movingPlatformV = (len, range, period) => makePiece('Elevator platform', 7, 15, P => {
    P.flat(5); const gap = Math.min(len, 10); const lip = P.jumpGap(gap, -0.5);
    P.plat({ type: 'moving', axis: 'y', cx: lip.x + gap / 2, cy: lip.y - 1.2, hw: gap * 0.3, hh: 0.3, range: Math.min(range * 0.3, 0.8), period });
    P.landing(10, 1); P.flat(3); return P.done();
  });
  const crumblePlatform = (len, h) => makePiece('Crumbling bridge', 5, 12, P => {
    P.flat(5); const x0 = P.x, y0 = P.y;
    P.to(x0 + 0.08, y0 - 10);
    P.plat({ type: 'crumble', cx: x0 + len / 2, cy: y0 - 0.35, hw: len / 2, hh: 0.35, delay: 1.5 });
    P.hz({ type: 'pit', x0, x1: x0 + len, y: y0 - 7 });
    P._open({ x: x0 + len - 0.08, y: y0 - 10 }, 'ground'); P.to(x0 + len, y0); P.h = 0;
    P.flat(6); return P.done();
  });

  // ────────────────────────────────────────────────────────────────────────────
  // CATEGORY 9: Special / advanced
  // ────────────────────────────────────────────────────────────────────────────
  const corkscrew = (len, a) => makePiece('Corkscrew curves', 5, 8, P => {
    P.flat(3); for (let i = 0; i < 4; i++) { const amp = a * (1 - i * 0.2) * (i % 2 ? -1 : 1); P.ease(len / 8, amp); P.ease(len / 8, -amp); } P.flat(3); return P.done();
  });
  const massiveRamp = (len, deg) => makePiece('Massive ramp', 9, 15, P => {
    P.flat(5); P.rampJump(5, Math.min(deg, 72), len * 1.3, 0); P.flat(5); return P.done();
  });
  const loopToGap = (r, gap) => makePiece('Loop to gap', 9, 14, P => {
    P.flat(4); P.loop(r); P.jumpGap(gap, -2); P.landing(12, 1); P.flat(3); return P.done();
  }, { tags: ['loop'] });
  const halfPipeToRamp = (len, h) => makePiece('Pipe to ramp', 6, 10, P => {
    P.flat(3); P.ease(len * 0.3, -h); P.flat(3); P.ease(len * 0.3, h); P.rampJump(3, 35, 16, 0); P.flat(3); return P.done();
  });
  const valleyLaunchLips = (len, d) => makePiece('Valley launch', 6, 10, P => {
    P.flat(3); P.ease(len * 0.4, -d); P.flat(2); P.ease(len * 0.3, d - 1); P.rampJump(3, 32, 16, 1); P.flat(3); return P.done();
  });
  const highSpeedFlat = (len) => makePiece('High-speed straight', 2, 0, P => {
    P.flat(3); P.ease(12, -2); const x0 = P.x; P.flat(8); P.hz({ type: 'boost', x0, x1: x0 + 8, y: P.y, power: 28 }); P.flat(len - 20);
    P.gemLine(x0, x0 + len - 22, P.y + 1.1, 6); return P.done();
  }, { calm: true });
  const springLaunch = (len, power) => makePiece('Spring launch', 6, 0, P => {
    P.flat(4); const x0 = P.x; P.flat(3); P.hz({ type: 'bounce', x0, x1: x0 + 3, y: P.y, power: Math.sqrt(2 * G() * power) });
    P.flat(len); P.landing(18, 2); P.flat(3); P.gem(x0 + 10, power * 0.9); return P.done();
  });
  const wallRide = (len, h) => makePiece('Wall ride', 7, 16, P => {
    const hh = h * 0.6;
    P.flat(4); P.turn(hh * 1.1, 45); P.turn(hh * 1.1, 0); P.flat(len * 0.4); P.landing(len * 0.6, hh * 0.7); P.flat(3); return P.done();
  });
  const loopWithRampAfter = (r, len) => makePiece('Loop + ramp', 8, 12, P => {
    P.flat(4); P.loop(r); P.rampJump(3, 30, len + 4, 0); P.flat(3); return P.done();
  }, { tags: ['loop'] });
  const technicalSection = (len) => makePiece('Technical section', 7, 14, P => {
    P.flat(3); P.bumps(10, 0.5, 2); P.flat(16); P.jumpGap(7, -0.5); P.landing(10, 0.8); P.flat(16); P.jumpGap(8, -0.5); P.landing(10, 0.7); P.flat(3); return P.done();
  });
  const grandFinale = (len) => makePiece('Grand finale', 10, 12, P => {
    P.flat(4); P.drop(9); P.flat(4); P.loop(6); P.rampJump(4, 40, 20, 2); P.flat(4); return P.done();
  }, { tags: ['loop'] });
  const descendingSpiral = (len, d) => makePiece('Descending waves', 4, 0, P => {
    P.flat(3); for (let i = 0; i < 4; i++) { P.ease(len / 8, 1.2); P.ease(len / 8, d / 4 - 1.2); } P.flat(3); return P.done();
  });
  const cascadingDrops = (len, h, n) => makePiece('Cascading drops', 6, 0, P => {
    P.flat(3); for (let i = 0; i < n; i++) { P.drop(h); P.flat(2); } P.flat(3); return P.done();
  });
  const megaGap = (gap, dy) => makePiece('Mega gap', 10, 18, P => {
    P.flat(8); P.jumpGap(gap * 0.75, dy, { gems: 5 }); P.landing(16, 2); P.flat(4); return P.done();
  });

  // ────────────────────────────────────────────────────────────────────────────
  // CATEGORY 10: Gem patterns
  // ────────────────────────────────────────────────────────────────────────────
  const gemLine = (len, y) => makePiece('Gem line', 1, 0, P => { P.flat(len); P.gemLine(3, len - 3, Math.min(y, 1.2), 8); return P.done(); }, { calm: true });
  const gemArc = (len, h, n) => makePiece('Gem arc', 3, 10, P => {
    P.flat(4); const r = P.rampJump(3, 28, len, 0); P.trajGems(7, r.h, 28, n, 2.0); P.flat(3); return P.done();
  });
  const gemRing = (n, rad) => makePiece('Gem ring', 4, 10, P => {
    P.flat(4); const r = P.rampJump(3, 30, 20, 0);
    const cx = 7 + 9, cy = r.h + 2.2; const rr = rad * 0.4;
    for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; P.gem(cx + rr * Math.cos(a), cy + rr * Math.sin(a)); }
    P.flat(3); return P.done();
  });
  const gemZigzag = (len, a, n) => makePiece('Gem zigzag', 2, 0, P => {
    P.flat(len); for (let i = 0; i < n * 2; i++) P.gem(3 + i * (len - 6) / (n * 2 - 1), i % 2 ? 1.0 + a * 0.2 : 1.0); return P.done();
  }, { calm: true });
  const gemHelix = (len, a, n) => makePiece('Gem helix', 3, 6, P => {
    P.flat(3); P.bumps(len, 1.5, 2); P.flat(3);
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1), x = 3 + t * len, gy = 1.5 * (1 - Math.cos(4 * Math.PI * t)) / 2;
      P.gem(x, gy + 1.1 + (i % 2 ? Math.sin(t * 8) * 0.3 : 0));
    }
    return P.done();
  });
  const gemSparse = (len, n) => makePiece('Gem sprinkle', 1, 0, P => {
    P.flat(3); P.ease(len / 2, 1.5); P.ease(len / 2, -1.5); P.flat(3);
    for (let i = 0; i < n; i++) { const t = (i + 0.5) / n; P.gem(3 + t * len, 1.5 * (1 - Math.cos(2 * Math.PI * t)) / 2 * 1 + 1.1); }
    return P.done();
  }, { calm: true });
  const gemDense = (len, n) => makePiece('Gem cluster', 2, 0, P => {
    P.flat(len + 6); const cols = Math.ceil(n / 2);
    for (let i = 0; i < n; i++) P.gem(3 + (i % cols) * (len / cols) + 1, 1.0 + Math.floor(i / cols) * 0.6); return P.done();
  }, { calm: true });
  const gemInvertedArc = (len, h, n) => makePiece('High gem arc', 6, 14, P => {
    P.flat(4); const r = P.rampJump(4, 42, len, 0); P.trajGems(8, r.h, 42, n, 2.2, V_DESIGN + 1.5, 0.9); P.flat(3); return P.done();
  });
  const gemDiamond = (len, h, n) => makePiece('Gem diamond', 4, 10, P => {
    P.flat(4); const r = P.rampJump(3, 30, len + 8, 0);
    const cx = 15, cy = r.h + 1.6, s = 1.4;
    [[0, s], [s, 0], [0, -s], [-s, 0], [0, 0]].slice(0, n).forEach(([dx, dy]) => P.gem(cx + dx, cy + dy));
    P.flat(3); return P.done();
  });
  const gemTrailOverGap = (gap, n) => makePiece('Gem trail gap', 5, 14, P => {
    P.flat(5); P.jumpGap(gap, -1, { gems: n }); P.landing(10, 1); P.flat(3); return P.done();
  });

  // ────────────────────────────────────────────────────────────────────────────
  // The 100 pieces
  // ────────────────────────────────────────────────────────────────────────────
  const pieces = [];
  // Category 1 (0-9)
  pieces[0] = flat(40, 0);
  pieces[1] = flatWithGems(30, 5);
  pieces[2] = gentleUphill(30, 3);
  pieces[3] = gentleDownhill(30, -3);
  pieces[4] = smallBump(15, 0.8);
  pieces[5] = mediumBump(12, 1.5);
  pieces[6] = washboard(20, 0.6, 4);
  pieces[7] = washboard(24, 0.6, 6);
  pieces[8] = gentleSCurve(40, 2);
  pieces[9] = valleyDip(30, -2);
  // Category 2 (10-21)
  pieces[10] = ramp(8, 15);
  pieces[11] = ramp(10, 25);
  pieces[12] = ramp(12, 35);
  pieces[13] = ramp(14, 45);
  pieces[14] = ramp(16, 55);
  pieces[15] = ramp(18, 65);
  pieces[16] = doubleKicker(24, 1.5, 3.0);
  pieces[17] = tripleKicker(36, 1.2, 2.0);
  pieces[18] = stepUp(20, 3);
  pieces[19] = stepUp(24, 5);
  pieces[20] = tabletop(28, 4);
  pieces[21] = reverseRamp(14, 45);
  // Category 3 (22-31)
  pieces[22] = gapJump(8, 0, 0);
  pieces[23] = gapJump(12, 0, 0);
  pieces[24] = gapJump(14, -2.5, 0);
  pieces[25] = gapJump(17, -5, 0);
  pieces[26] = gapJump(10, -3.5, 0);
  pieces[27] = gapJump(9, 1.5, 0);
  pieces[28] = doubleGap(24, 8, 0);
  pieces[29] = gapWithHazard(14, 'spikes');
  pieces[30] = chasms(28, -4);
  pieces[31] = gapWithGemArc(13, 4);
  // Category 4 (32-39)
  pieces[32] = drop(10, 2);
  pieces[33] = drop(12, 4);
  pieces[34] = drop(14, 7);
  pieces[35] = drop(18, 12);
  pieces[36] = cliffToValley(20, -6);
  pieces[37] = steppedDrops(30, 3, 3);
  pieces[38] = dropIntoLoop(20, 4);
  pieces[39] = dropWithBounce(16, 5);
  // Category 5 (40-47)
  pieces[40] = loop(3);
  pieces[41] = loop(4.5);
  pieces[42] = loop(7);
  pieces[43] = loopWithRamp(5);
  pieces[44] = loopThenGap(4.5, 10);
  pieces[45] = doubleLoop(4, 4);
  pieces[46] = halfLoop(5);
  pieces[47] = loopThenDrop(5, 5);
  // Category 6 (48-55)
  pieces[48] = quarterPipeRight(10, 4);
  pieces[49] = quarterPipeLeft(10, -4);
  pieces[50] = halfPipe(30, 3);
  pieces[51] = bowl(20, 5);
  pieces[52] = bankedTurn(20, 3);
  pieces[53] = sCurveWide(50, 4);
  pieces[54] = waveSection(40, 2, 4);
  pieces[55] = rollerCoaster(60, 5, 3);
  // Category 7 (56-63)
  pieces[56] = floatingPlatform(10, 4, 2);
  pieces[57] = floatingPlatform(20, 4, 2);
  pieces[58] = narrowBridge(16, 4, 1);
  pieces[59] = tunnel(24, 4, 3);
  pieces[60] = stairsUp(24, 1.5, 5);
  pieces[61] = stairsDown(24, 1.5, 5);
  pieces[62] = multiPlatforms(40, 3, 3);
  pieces[63] = wideBridge(30, 3, 2);
  // Category 8 (64-75)
  pieces[64] = hazardBlock(20, 3, 1);
  pieces[65] = hazardBlock(24, 3, 2);
  pieces[66] = hazardBlock(28, 3, 3);
  pieces[67] = spikedGap(14);
  pieces[68] = rotSaw(16, 4, 2.5);
  pieces[69] = swingPendulum(18, 6, 3);
  pieces[70] = speedBoost(20);
  pieces[71] = slowZone(16);
  pieces[72] = bouncePad(14, 6);
  pieces[73] = movingPlatformH(20, 5, 3);
  pieces[74] = movingPlatformV(18, 3, 2);
  pieces[75] = crumblePlatform(16, 3);
  // Category 9 (76-89)
  pieces[76] = corkscrew(60, 6);
  pieces[77] = massiveRamp(20, 75);
  pieces[78] = loopToGap(5, 14);
  pieces[79] = halfPipeToRamp(36, 4);
  pieces[80] = valleyLaunchLips(40, 6);
  pieces[81] = highSpeedFlat(60, 0);
  pieces[82] = springLaunch(12, 8);
  pieces[83] = wallRide(20, 6);
  pieces[84] = loopWithRampAfter(5, 12);
  pieces[85] = technicalSection(50);
  pieces[86] = grandFinale(80);
  pieces[87] = descendingSpiral(64, -8);
  pieces[88] = cascadingDrops(48, 3, 5);
  pieces[89] = megaGap(26, -8);
  // Category 10 (90-99)
  pieces[90] = gemLine(30, 1.5);
  pieces[91] = gemArc(20, 8, 8);
  pieces[92] = gemRing(8, 5);
  pieces[93] = gemZigzag(30, 4, 6);
  pieces[94] = gemHelix(40, 4, 12);
  pieces[95] = gemSparse(50, 8);
  pieces[96] = gemDense(20, 12);
  pieces[97] = gemInvertedArc(24, 10, 6);
  pieces[98] = gemDiamond(12, 6, 5);
  pieces[99] = gemTrailOverGap(12, 7);

  // Make every name unique (parametric variants of the same family get a numeral suffix)
  const seen = {};
  const ROMAN = ['', ' II', ' III', ' IV', ' V', ' VI', ' VII', ' VIII'];
  pieces.forEach((p, i) => {
    p.id = i;
    seen[p.name] = (seen[p.name] || 0) + 1;
    if (seen[p.name] > 1) p.name += ROMAN[seen[p.name] - 1] || ` #${seen[p.name]}`;
  });

  root.TRACK_PIECES = pieces;
  root.TrackPieceUtils = { arcPoints, curvePoints, flightRange, PB, makePiece, V_DESIGN };
})(typeof window !== 'undefined' ? window : globalThis);
