// js/particles.js — Pooled world-space particle system + bike trail + shockwave rings.
(function (root) {
  const MAX = 500;

  class ParticleSystem {
    constructor() {
      this.pool = [];
      for (let i = 0; i < MAX; i++) this.pool.push({ alive: false });
      this.rings = [];         // shockwaves / gem ripples {x,y,r,max,life,t,color,width}
      this.trail = [];         // bike trail points {x,y,age}
      this.webs = [];          // web strands from crash {x,y,a,len,life,t}
      this.quality = 2;        // 0 low, 1 med, 2 high
    }

    setQuality(q) { this.quality = q; }
    _factor() { return this.quality === 0 ? 0.35 : this.quality === 1 ? 0.65 : 1; }

    spawn(o) {
      for (const p of this.pool) {
        if (!p.alive) {
          p.alive = true;
          p.x = o.x; p.y = o.y; p.vx = o.vx || 0; p.vy = o.vy || 0;
          p.life = o.life || 0.6; p.t = 0; p.size = o.size || 0.12;
          p.color = o.color || '#fff'; p.drag = o.drag === undefined ? 1.5 : o.drag;
          p.g = o.g === undefined ? -12 : o.g; p.shape = o.shape || 'dot';
          p.spin = o.spin || 0; p.a = o.a || 0;
          return p;
        }
      }
      return null;
    }

    /** Wheel sparks / dust on landing. */
    sparks(x, y, color, n = CONFIG.SPARK_COUNT, speed = 7) {
      n = Math.round(n * this._factor());
      for (let i = 0; i < n; i++) {
        const a = Math.PI * (0.05 + Math.random() * 0.9);
        const s = speed * (0.3 + Math.random() * 0.7);
        this.spawn({ x, y, vx: Math.cos(a) * s - 3, vy: Math.sin(a) * s, life: 0.3 + Math.random() * 0.4, size: 0.06 + Math.random() * 0.08, color, shape: 'spark' });
      }
    }

    /** Big neon explosion on crash. */
    crashBurst(x, y, colors) {
      const n = Math.round(CONFIG.CRASH_PARTICLE_COUNT * this._factor());
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, s = 4 + Math.random() * 16;
        this.spawn({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s + 3, life: 0.6 + Math.random() * 0.9, size: 0.08 + Math.random() * 0.22, color: colors[i % colors.length], shape: Math.random() < 0.3 ? 'shard' : 'spark', spin: (Math.random() - 0.5) * 20, drag: 1.2, g: -18 });
      }
      this.ring(x, y, colors[0], 7, 0.6, 0.35);
      this.ring(x, y, '#ffffff', 4, 0.4, 0.2);
      // web strands shooting out from the impact
      for (let i = 0; i < 8; i++) this.webs.push({ x, y, a: i / 8 * Math.PI * 2 + Math.random() * 0.3, len: 3 + Math.random() * 4, life: 0.9, t: 0 });
    }

    /** Gem pickup sparkle ripple. */
    gemSparkle(x, y, color = '#c77dff') {
      const n = Math.round(10 * this._factor());
      for (let i = 0; i < n; i++) {
        const a = i / n * Math.PI * 2, s = 3 + Math.random() * 2;
        this.spawn({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.4, size: 0.08, color, shape: 'star', g: 0, drag: 3 });
      }
      this.ring(x, y, color, 1.4, 0.35, 0.08);
    }

    /** Landing shockwave. */
    landing(x, y, color, strength = 1) {
      this.ring(x, y, color, 2.5 + strength * 2, 0.45, 0.12);
      this.sparks(x, y, color, CONFIG.SPARK_COUNT * Math.min(2, strength), 5 + strength * 3);
    }

    ring(x, y, color, max, life, width) { this.rings.push({ x, y, r: 0.2, max, life, t: 0, color, width }); }

    /** Record bike position for the neon trail. */
    pushTrail(x, y) {
      const last = this.trail[this.trail.length - 1];
      if (last && Math.hypot(last.x - x, last.y - y) < 0.15) return;
      this.trail.push({ x, y, age: 0 });
      const max = Math.round(CONFIG.TRAIL_MAX * (this.quality === 0 ? 0.5 : 1));
      while (this.trail.length > max) this.trail.shift();
    }
    clearTrail() { this.trail.length = 0; }

    update(dt) {
      for (const p of this.pool) {
        if (!p.alive) continue;
        p.t += dt;
        if (p.t >= p.life) { p.alive = false; continue; }
        const k = Math.exp(-p.drag * dt);
        p.vx *= k; p.vy = p.vy * k + p.g * dt;
        p.x += p.vx * dt; p.y += p.vy * dt;
        p.a += p.spin * dt;
      }
      for (const r of this.rings) { r.t += dt; r.r = r.max * Math.min(1, r.t / r.life) ** 0.5; }
      this.rings = this.rings.filter(r => r.t < r.life);
      for (const w of this.webs) w.t += dt;
      this.webs = this.webs.filter(w => w.t < w.life);
      for (const t of this.trail) t.age += dt;
    }

    clear() {
      for (const p of this.pool) p.alive = false;
      this.rings.length = 0; this.webs.length = 0; this.trail.length = 0;
    }

    /** Draw everything with the camera transform. */
    draw(ctx, cam) {
      const s = cam.scale;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const p of this.pool) {
        if (!p.alive) continue;
        const sx = cam.toScreenX(p.x), sy = cam.toScreenY(p.y);
        if (sx < -20 || sx > cam.w + 20 || sy < -20 || sy > cam.h + 20) continue;
        const f = 1 - p.t / p.life;
        ctx.globalAlpha = Math.max(0, f);
        ctx.fillStyle = p.color; ctx.strokeStyle = p.color;
        const r = Math.max(1, p.size * s);
        if (p.shape === 'spark') {
          ctx.lineWidth = Math.max(1, r * 0.8);
          ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx - p.vx * 0.03 * s, sy + p.vy * 0.03 * s); ctx.stroke();
        } else if (p.shape === 'shard') {
          ctx.save(); ctx.translate(sx, sy); ctx.rotate(p.a);
          ctx.fillRect(-r, -r * 0.4, r * 2, r * 0.8); ctx.restore();
        } else if (p.shape === 'star') {
          ctx.beginPath();
          ctx.moveTo(sx, sy - r * 2); ctx.lineTo(sx + r * 0.5, sy); ctx.lineTo(sx, sy + r * 2); ctx.lineTo(sx - r * 0.5, sy); ctx.closePath();
          ctx.moveTo(sx - r * 2, sy); ctx.lineTo(sx, sy + r * 0.5); ctx.lineTo(sx + r * 2, sy); ctx.lineTo(sx, sy - r * 0.5); ctx.closePath();
          ctx.fill();
        } else {
          ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.fill();
        }
      }
      for (const r of this.rings) {
        const f = 1 - r.t / r.life;
        ctx.globalAlpha = f;
        ctx.strokeStyle = r.color;
        ctx.lineWidth = Math.max(1, r.width * s * f + 1);
        ctx.beginPath(); ctx.arc(cam.toScreenX(r.x), cam.toScreenY(r.y), r.r * s, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.lineWidth = 1.5; ctx.strokeStyle = '#ffffff';
      for (const w of this.webs) {
        const f = w.t / w.life, L = w.len * Math.min(1, f * 4);
        ctx.globalAlpha = 1 - f;
        const x0 = cam.toScreenX(w.x), y0 = cam.toScreenY(w.y);
        const x1 = cam.toScreenX(w.x + Math.cos(w.a) * L), y1 = cam.toScreenY(w.y + Math.sin(w.a) * L);
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      }
      ctx.restore();
    }

    /** Neon trail behind the bike. */
    drawTrail(ctx, cam, color) {
      const t = this.trail;
      if (t.length < 2) return;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (let i = 1; i < t.length; i++) {
        const f = i / t.length;
        ctx.globalAlpha = f * 0.55;
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(1, f * cam.scale * 0.35);
        ctx.beginPath();
        ctx.moveTo(cam.toScreenX(t[i - 1].x), cam.toScreenY(t[i - 1].y));
        ctx.lineTo(cam.toScreenX(t[i].x), cam.toScreenY(t[i].y));
        ctx.stroke();
      }
      ctx.restore();
    }
  }
  root.ParticleSystem = ParticleSystem;
})(typeof window !== 'undefined' ? window : globalThis);
