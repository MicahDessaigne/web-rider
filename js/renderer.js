// js/renderer.js — Canvas renderer: parallax night city, thick neon track, bike & rider, hazards, gems.
(function (root) {
  const THEMES = [
    { name: 'Midnight Web',  bg: ['#050a24', '#101a4a'], edge: '#ff2d55', glow: '#ff5c7a', fill: '#0a0f2e', sky: ['#0d1640', '#16215a'], win: '#ffd36b' },
    { name: 'Blue Swing',    bg: ['#020818', '#0a2a5e'], edge: '#00d4ff', glow: '#59e6ff', fill: '#04112b', sky: ['#082048', '#0d2f66'], win: '#9be8ff' },
    { name: 'Crimson Dusk',  bg: ['#14020c', '#3d0a24'], edge: '#ff3b3b', glow: '#ff8080', fill: '#1a0510', sky: ['#2a0718', '#3f0d26'], win: '#ffb27a' },
    { name: 'White Night',   bg: ['#070b1e', '#1b2450'], edge: '#ffff', glow: '#bcd4ff', fill: '#0b1030', sky: ['#121a44', '#1c2760'], win: '#ffff' },
    { name: 'Violet Rooftops', bg: ['#0c0420', '#2a0e55'], edge: '#c77dff', glow: '#e0b0ff', fill: '#12062a', sky: ['#1d0b40', '#2b1060'], win: '#ffcf70' },
    { name: 'Toxic Alley',   bg: ['#020f0a', '#08301f'], edge: '#39ff14', glow: '#8cff73', fill: '#03140d', sky: ['#062418', '#0a3322'], win: '#c8ff9e' },
    { name: 'Golden Hour',   bg: ['#120a02', '#3a2408'], edge: '#ffc93c', glow: '#ffe08a', fill: '#160d03', sky: ['#2a1a06', '#3d270a'], win: '#fff1b0' },
    { name: 'Neon Harbor',   bg: ['#001018', '#003548'], edge: '#00ffc8', glow: '#6fffe0', fill: '#001820', sky: ['#002433', '#003a4d'], win: '#a8fff0' },
    { name: 'Hot Pink Blvd', bg: ['#16021a', '#45074f'], edge: '#ff4fd8', glow: '#ff9cec', fill: '#1a0420', sky: ['#2c0835', '#420c4f'], win: '#ffd0f5' },
    { name: 'Inferno Core',  bg: ['#140300', '#451000'], edge: '#ff6a00', glow: '#ffa060', fill: '#1a0600', sky: ['#2e0a00', '#451200'], win: '#ffe066' },
  ];

  class Renderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.quality = 2;
      this.w = 1; this.h = 1; this.dpr = 1;
      this.layers = new Map();
      this.themeIndex = 0; this.prevTheme = 0; this.themeFade = 1;
      this.time = 0;
    }

    setQuality(q) { this.quality = q; this.resize(this.w, this.h); }

    resize(w, h) {
      this.w = w; this.h = h;
      this.dpr = Math.min(this.quality === 0 ? 1 : 2, root.devicePixelRatio || 1);
      this.canvas.width = Math.round(w * this.dpr); this.canvas.height = Math.round(h * this.dpr);
      this.canvas.style.width = w + 'px'; this.canvas.style.height = h + 'px';
      this.layers.clear();
    }

    setTheme(i) {
      i = ((i % THEMES.length) + THEMES.length) % THEMES.length;
      if (i === this.themeIndex) return;
      this.prevTheme = this.themeIndex; this.themeIndex = i; this.themeFade = 0;
    }
    get theme() { return THEMES[this.themeIndex]; }

    /** Pre-rendered background layers (gradient+stars+web, far skyline, near skyline). */
    _layer(ti) {
      if (this.layers.has(ti)) return this.layers.get(ti);
      const T = THEMES[ti], w = this.w, h = this.h;
      const mk = (cw, ch) => { const c = document.createElement('canvas'); c.width = cw; c.height = ch; return c; };
      const rnd = root.mulberry32(ti * 977 + 13);
      const sky = mk(w, h), g = sky.getContext('2d');
      const grad = g.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, T.bg[0]); grad.addColorStop(1, T.bg[1]);
      g.fillStyle = grad; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 140; i++) {
        g.globalAlpha = 0.3 + rnd() * 0.7; g.fillStyle = '#fff';
        const s = rnd() < 0.1 ? 2 : 1; g.fillRect(rnd() * w, rnd() * h * 0.7, s, s);
      }
      // faint spider-web in the corner
      g.globalAlpha = 0.07; g.strokeStyle = '#ffff'; g.lineWidth = 1;
      const cx = w * 0.92, cy = h * 0.05, R = Math.min(w, h) * 0.5;
      for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); g.stroke(); }
      for (let r = R / 6; r <= R; r += R / 6) { g.beginPath(); for (let i = 0; i <= 12; i++) { const a = i / 12 * Math.PI * 2; const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r; i ? g.quadraticCurveTo(cx + Math.cos(a - Math.PI / 12) * r * 0.85, cy + Math.sin(a - Math.PI / 12) * r * 0.85, x, y) : g.moveTo(x, y); } g.stroke(); }
      g.globalAlpha = 1;
      const city = (color, minH, maxH, winP) => {
        const cw = 1024, ch = Math.ceil(h * 0.6), c = mk(cw, ch), q = c.getContext('2d');
        let x = 0;
        while (x < cw) {
          const bw = 30 + rnd() * 70, bh = ch * (minH + rnd() * (maxH - minH));
          q.fillStyle = color; q.fillRect(x, ch - bh, bw, bh);
          if (rnd() < 0.25) q.fillRect(x + bw * 0.45, ch - bh - 18, 3, 18); // antenna
          if (this.quality > 0) {
            q.fillStyle = T.win;
            for (let wy = ch - bh + 8; wy < ch - 6; wy += 9) for (let wx = x + 5; wx < x + bw - 6; wx += 8) if (rnd() < winP) { q.globalAlpha = 0.35 + rnd() * 0.5; q.fillRect(wx, wy, 3, 4); }
            q.globalAlpha = 1;
          }
          x += bw + 2 + rnd() * 6;
        }
        return c;
      };
      const L = { sky, far: city(T.sky[0], 0.25, 0.7, 0.12), near: city(T.sky[1], 0.15, 0.5, 0.2) };
      this.layers.set(ti, L);
      return L;
    }

    _drawBackground(ctx, cam, ti, alpha) {
      const L = this._layer(ti);
      ctx.globalAlpha = alpha;
      ctx.drawImage(L.sky, 0, 0, this.w, this.h);
      const par = (img, f, yOff) => {
        const off = -((cam.x * cam.scale * f) % img.width + img.width) % img.width;
        const y = this.h - img.height + yOff + (cam.y * cam.scale * f * 0.3);
        for (let x = off; x < this.w; x += img.width) ctx.drawImage(img, x, Math.min(this.h - img.height * 0.4, y));
      };
      par(L.far, 0.06, 0);
      par(L.near, 0.15, this.h * 0.08);
      ctx.globalAlpha = 1;
    }

    _segPath(cam, pts) {
      const p = new Path2D();
      for (let i = 0; i < pts.length; i++) {
        const x = cam.toScreenX(pts[i].x), y = cam.toScreenY(pts[i].y);
        i ? p.lineTo(x, y) : p.moveTo(x, y);
      }
      return p;
    }

    _neonStroke(ctx, path, T, s) {
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      if (this.quality > 0) {
        ctx.globalAlpha = 0.18; ctx.strokeStyle = T.glow; ctx.lineWidth = Math.max(10, s * 0.6); ctx.stroke(path);
        ctx.globalAlpha = 0.4; ctx.lineWidth = Math.max(6, s * 0.32); ctx.stroke(path);
      }
      ctx.globalAlpha = 1; ctx.strokeStyle = T.edge; ctx.lineWidth = Math.max(3, s * 0.14); ctx.stroke(path);
      ctx.strokeStyle = '#ffff'; ctx.globalAlpha = 0.85; ctx.lineWidth = Math.max(1, s * 0.04); ctx.stroke(path);
      ctx.globalAlpha = 1;
    }

    _drawTrack(ctx, cam, track, T) {
      const vb = cam.viewBounds(6), s = cam.scale;
      const segs = track.getSegmentsInRange(vb.x0, vb.x1);
      const bottom = this.h + 20;
      for (const sg of segs) {
        if (sg.kind === 'platform') continue;
        const pts = sg.pts.filter((p, i, a) => (p.x >= vb.x0 && p.x <= vb.x1) || (a[i + 1] && a[i + 1].x >= vb.x0 && p.x <= vb.x1) || (a[i - 1] && a[i - 1].x <= vb.x1 && p.x >= vb.x0));
        if (pts.length < 2) continue;
        const line = this._segPath(cam, pts);
        if (sg.kind === 'ground' || sg.kind === 'bridge') {
          const fill = new Path2D();
          if (sg.kind === 'ground') {
            pts.forEach((p, i) => i ? fill.lineTo(cam.toScreenX(p.x), cam.toScreenY(p.y)) : fill.moveTo(cam.toScreenX(p.x), cam.toScreenY(p.y)));
            fill.lineTo(cam.toScreenX(pts[pts.length - 1].x), bottom); fill.lineTo(cam.toScreenX(pts[0].x), bottom);
          } else {
            const th = (sg.thick || 0.5) + 0.3;
            pts.forEach((p, i) => i ? fill.lineTo(cam.toScreenX(p.x), cam.toScreenY(p.y)) : fill.moveTo(cam.toScreenX(p.x), cam.toScreenY(p.y)));
            for (let i = pts.length - 1; i >= 0; i--) fill.lineTo(cam.toScreenX(pts[i].x), cam.toScreenY(pts[i].y - th));
          }
          fill.closePath();
          ctx.fillStyle = T.fill; ctx.fill(fill);
          if (this.quality > 0) { ctx.globalAlpha = 0.08; ctx.strokeStyle = T.edge; ctx.lineWidth = 1; ctx.save(); ctx.clip(fill); this._webPattern(ctx, cam); ctx.restore(); ctx.globalAlpha = 1; }
          this._neonStroke(ctx, line, T, s);
        } else if (sg.kind === 'island' || sg.kind === 'ceiling') {
          const p = this._segPath(cam, sg.pts); p.closePath();
          ctx.fillStyle = T.fill; ctx.fill(p); this._neonStroke(ctx, p, T, s);
        } else {
          const active = track.loops[sg.loop];
          ctx.globalAlpha = active && active.phase !== sg.part ? 0.75 : 1;
          this._neonStroke(ctx, line, T, s);
        }
      }
    }

    _webPattern(ctx, cam) {
      const step = 3 * cam.scale, ox = -(cam.x * cam.scale) % step;
      ctx.beginPath();
      for (let x = ox - this.h; x < this.w + this.h; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x + this.h, this.h); ctx.moveTo(x + this.h, 0); ctx.lineTo(x, this.h); }
      ctx.stroke();
    }

    _drawGems(ctx, cam, track) {
      const vb = cam.viewBounds(2), s = cam.scale;
      for (const g of track.gems) {
        if (g.taken || g.x < vb.x0 || g.x > vb.x1) continue;
        const x = cam.toScreenX(g.x), y = cam.toScreenY(g.y + Math.sin(this.time * 3 + g.x) * 0.08), r = s * 0.32;
        ctx.globalAlpha = 0.35; ctx.fillStyle = '#b14dff';
        ctx.beginPath(); ctx.arc(x, y, r * 1.6, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1; ctx.fillStyle = '#c77dff'; ctx.strokeStyle = '#f3e1ff'; ctx.lineWidth = Math.max(1, s * 0.05);
        ctx.beginPath(); ctx.moveTo(x, y - r); ctx.lineTo(x + r * 0.75, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r * 0.75, y); ctx.closePath(); ctx.fill(); ctx.stroke();
      }
    }

    _drawHazards(ctx, cam, track) {
      const vb = cam.viewBounds(8), s = cam.scale;
      for (const h of track.hazards) {
        const hx = h.x !== undefined ? h.x : h.x0 !== undefined ? h.x0 : h.px;
        if (hx > vb.x1 || (h.x1 || hx + (h.w || 0) + (h.len || 0) + (h.r || 0)) < vb.x0) continue;
        ctx.save();
        if (h.type === 'saw' || h.type === 'pendulum') {
          let cx = h.x, cy = h.y;
          if (h.type === 'pendulum') {
            const b = track.pendulumBob(h); cx = b.x; cy = b.y;
            ctx.strokeStyle = '#ffff'; ctx.globalAlpha = 0.8; ctx.lineWidth = Math.max(1, s * 0.05);
            ctx.beginPath(); ctx.moveTo(cam.toScreenX(h.px), cam.toScreenY(h.py)); ctx.lineTo(cam.toScreenX(cx), cam.toScreenY(cy)); ctx.stroke();
            ctx.globalAlpha = 1;
          }
          const x = cam.toScreenX(cx), y = cam.toScreenY(cy), r = h.r * s;
          ctx.translate(x, y); ctx.rotate(-track.time * (h.speed || 4));
          ctx.fillStyle = 'rgba(255,40,60,0.25)'; ctx.beginPath(); ctx.arc(0, 0, r * 1.3, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#ff1f3d'; ctx.beginPath();
          for (let i = 0; i < 24; i++) { const a = i / 24 * Math.PI * 2, rr = i % 2 ? r : r * 0.8; ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
          ctx.closePath(); ctx.fill();
          ctx.strokeStyle = '#ffd0d6'; ctx.lineWidth = Math.max(1, s * 0.06); ctx.stroke();
          ctx.fillStyle = '#300'; ctx.beginPath(); ctx.arc(0, 0, r * 0.25, 0, Math.PI * 2); ctx.fill();
        } else if (h.type === 'spike') {
          const n = Math.max(1, Math.round(h.w / 0.6)), wsp = h.w / n;
          ctx.fillStyle = '#ff1f3d'; ctx.strokeStyle = '#ffb3be'; ctx.lineWidth = Math.max(1, s * 0.04);
          ctx.beginPath();
          for (let i = 0; i < n; i++) {
            ctx.moveTo(cam.toScreenX(h.x + i * wsp), cam.toScreenY(h.y));
            ctx.lineTo(cam.toScreenX(h.x + (i + 0.5) * wsp), cam.toScreenY(h.y + h.h));
            ctx.lineTo(cam.toScreenX(h.x + (i + 1) * wsp), cam.toScreenY(h.y));
          }
          ctx.closePath(); ctx.fill(); ctx.stroke();
        } else if (h.type === 'boost' || h.type === 'slow' || h.type === 'bounce') {
          const col = h.type === 'boost' ? '#00e5ff' : h.type === 'slow' ? '#9d4dff' : '#ffe600';
          const x0 = cam.toScreenX(h.x0), x1 = cam.toScreenX(h.x1), y = cam.toScreenY(h.y);
          ctx.fillStyle = col; ctx.globalAlpha = 0.85;
          ctx.fillRect(x0, y - s * 0.12, x1 - x0, s * 0.18);
          ctx.globalAlpha = 1; ctx.strokeStyle = col; ctx.lineWidth = Math.max(2, s * 0.07);
          if (h.type !== 'slow') {
            const step = s * 1.0, off = (this.time * s * 3) % step;
            for (let x = x0 + off; x < x1 - s * 0.3; x += step) {
              ctx.beginPath();
              if (h.type === 'boost') { ctx.moveTo(x, y - s * 0.55); ctx.lineTo(x + s * 0.3, y - s * 0.35); ctx.lineTo(x, y - s * 0.15); }
              else { ctx.moveTo(x - s * 0.2, y - s * 0.25); ctx.lineTo(x, y - s * 0.6); ctx.lineTo(x + s * 0.2, y - s * 0.25); }
              ctx.stroke();
            }
          }
        }
        ctx.restore();
      }
      // platforms
      for (const p of track.platforms) {
        const d = p.def;
        if (p.x + d.hw < vb.x0 || p.x - d.hw > vb.x1) continue;
        ctx.save();
        const shake = d.type === 'crumble' && !p.crumbled ? (Math.random() - 0.5) * p.shake * 3 : 0;
        ctx.translate(cam.toScreenX(p.x) + shake, cam.toScreenY(p.y)); ctx.rotate(-(p.angle || 0));
        const col = d.type === 'crumble' ? '#ffb000' : '#00e5ff';
        ctx.fillStyle = this.theme.fill; ctx.fillRect(-d.hw * s, -d.hh * s, d.hw * 2 * s, d.hh * 2 * s);
        ctx.strokeStyle = col; ctx.lineWidth = Math.max(2, s * 0.1); ctx.globalAlpha = p.crumbled ? 0.4 : 1;
        ctx.strokeRect(-d.hw * s, -d.hh * s, d.hw * 2 * s, d.hh * 2 * s);
        if (d.type === 'crumble') { ctx.beginPath(); for (let x = -d.hw + 1; x < d.hw; x += 1.6) { ctx.moveTo(x * s, -d.hh * s); ctx.lineTo((x + 0.4) * s, d.hh * s); } ctx.stroke(); }
        ctx.restore();
      }
      // finish line
      if (isFinite(track.finishX) && track.finishX > vb.x0 && track.finishX < vb.x1) {
        const gy = track.getGroundYAt(track.finishX) || 0;
        const x = cam.toScreenX(track.finishX), y0 = cam.toScreenY(gy), y1 = cam.toScreenY(gy + 6), sq = s * 0.5;
        for (let i = 0; i < 12; i++) for (let j = 0; j < 2; j++) { ctx.fillStyle = (i + j) % 2 ? '#fff' : '#111'; ctx.fillRect(x + j * sq - sq, y1 + i * sq, sq, sq); }
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1); ctx.stroke();
      }
    }

    /** Bike + rider. state = interpolated {x,y,a, fx,fy,fa, rx,ry,ra}. */
    _drawBike(ctx, cam, st, skin, crashed) {
      const s = cam.scale;
      const C = root.CONFIG;

      const wheel = (x, y, a) => {
        const sx = cam.toScreenX(x);
        const sy = cam.toScreenY(y);
        const r = C.WHEEL_RADIUS * s;

        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(-a);

        ctx.fillStyle = '#080a12';
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = '#c8d3e8';
        ctx.lineWidth = Math.max(1.5, r * 0.12);
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.78, 0, Math.PI * 2);
        ctx.stroke();

        ctx.strokeStyle = skin.accent || '#ffff';
        ctx.lineWidth = Math.max(2, r * 0.24);
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.88, -0.45, 1.75);
        ctx.stroke();

        ctx.strokeStyle = 'rgba(220,235,255,0.75)';
        ctx.lineWidth = Math.max(1, r * 0.055);
        for (let i = 0; i < 6; i++) {
          const a0 = i * Math.PI / 3;
          ctx.beginPath();
          ctx.moveTo(Math.cos(a0) * r * 0.18, Math.sin(a0) * r * 0.18);
          ctx.lineTo(Math.cos(a0) * r * 0.72, Math.sin(a0) * r * 0.72);
          ctx.stroke();
        }

        ctx.restore();
      };

      wheel(st.rx, st.ry, st.ra);
      wheel(st.fx, st.fy, st.fa);

      if (crashed) return;

      ctx.save();
      ctx.translate(cam.toScreenX(st.x), cam.toScreenY(st.y));
      ctx.rotate(-st.a);
      ctx.scale(s, -s);

      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      const rearX = C.REAR_WHEEL_X;
      const frontX = C.FRONT_WHEEL_X;
      const wheelY = C.WHEEL_Y_OFFSET;

      // Motorcycle frame and fork: a narrow triangular frame between the wheels.
      ctx.strokeStyle = '#151827';
      ctx.lineWidth = 0.13;
      ctx.beginPath();
      ctx.moveTo(rearX, wheelY);
      ctx.lineTo(-0.24, 0.12);
      ctx.lineTo(0.30, 0.12);
      ctx.lineTo(frontX, wheelY);
      ctx.moveTo(-0.24, 0.12);
      ctx.lineTo(0.02, -0.12);
      ctx.lineTo(0.30, 0.12);
      ctx.stroke();

      ctx.strokeStyle = skin.body;
      ctx.lineWidth = 0.07;
      ctx.beginPath();
      ctx.moveTo(rearX, wheelY);
      ctx.lineTo(-0.24, 0.12);
      ctx.lineTo(0.30, 0.12);
      ctx.lineTo(frontX, wheelY);
      ctx.stroke();

      // Engine block.
      ctx.fillStyle = '#171a29';
      ctx.strokeStyle = skin.accent || '#ffff';
      ctx.lineWidth = 0.035;
      ctx.beginPath();
      ctx.moveTo(-0.18, 0.08);
      ctx.lineTo(0.20, 0.08);
      ctx.lineTo(0.26, -0.16);
      ctx.lineTo(-0.12, -0.20);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Seat and compact fuel tank, avoiding a broad car-like body shape.
      ctx.fillStyle = skin.body;
      ctx.beginPath();
      ctx.moveTo(-0.53, 0.23);
      ctx.lineTo(-0.12, 0.27);
      ctx.lineTo(0.27, 0.24);
      ctx.lineTo(0.43, 0.13);
      ctx.lineTo(0.13, 0.08);
      ctx.lineTo(-0.30, 0.10);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = skin.accent || '#ffff';
      ctx.lineWidth = 0.035;
      ctx.stroke();

      // Rear suspension.
      ctx.strokeStyle = '#d7e4fa';
      ctx.lineWidth = 0.045;
      ctx.beginPath();
      ctx.moveTo(rearX + 0.05, wheelY + 0.03);
      ctx.lineTo(-0.24, 0.12);
      ctx.stroke();

      // Front fork and handlebar.
      ctx.strokeStyle = '#e6efff';
      ctx.lineWidth = 0.055;
      ctx.beginPath();
      ctx.moveTo(0.30, 0.14);
      ctx.lineTo(frontX, wheelY);
      ctx.moveTo(0.27, 0.37);
      ctx.lineTo(0.48, 0.39);
      ctx.stroke();

      // Rider: bent legs, crouched torso and arms reaching the bars.
      ctx.strokeStyle = skin.suit2 || '#2458ff';
      ctx.lineWidth = 0.14;
      ctx.beginPath();
      ctx.moveTo(-0.28, 0.25);
      ctx.lineTo(-0.05, 0.00);
      ctx.lineTo(0.20, -0.02);
      ctx.moveTo(-0.25, 0.22);
      ctx.lineTo(-0.48, 0.02);
      ctx.lineTo(-0.62, 0.00);
      ctx.stroke();

      ctx.strokeStyle = skin.suit || '#d0102a';
      ctx.lineWidth = 0.20;
      ctx.beginPath();
      ctx.moveTo(-0.30, 0.32);
      ctx.lineTo(-0.15, 0.62);
      ctx.lineTo(0.12, 0.54);
      ctx.lineTo(0.39, 0.40);
      ctx.stroke();

      // Gloved hand on the handlebar.
      ctx.fillStyle = skin.accent || '#ffff';
      ctx.beginPath();
      ctx.arc(0.47, 0.39, 0.065, 0, Math.PI * 2);
      ctx.fill();

      // Helmet and bright eye lenses.
      const hx = C.HEAD_OFFSET_X;
      const hy = C.HEAD_OFFSET_Y;
      const hr = C.HEAD_RADIUS * 1.12;

      ctx.fillStyle = skin.suit || '#d0102a';
      ctx.strokeStyle = '#11131e';
      ctx.lineWidth = 0.035;
      ctx.beginPath();
      ctx.arc(hx, hy, hr, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#f7fbff';
      ctx.beginPath();
      ctx.ellipse(hx + 0.10, hy + 0.015, 0.075, 0.045, 0.18, 0, Math.PI * 2);
      ctx.ellipse(hx + 0.22, hy - 0.015, 0.055, 0.035, 0.18, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    }

    _drawPopups(ctx, cam, popups, st) {
      if (!popups) return;
      const s = cam.scale;
      let i = 0;
      for (const p of popups) {
        const f = p.t / p.life, rise = Math.min(1, p.t * 6);
        const x = cam.toScreenX(st.x), y = cam.toScreenY(st.y) + s * (1.6 + i * 0.75) + (1 - rise) * 12;
        ctx.globalAlpha = Math.min(1, (1 - f) * 3);
        ctx.font = `800 ${Math.round(Math.max(14, s * (p.size || 0.55)) * (0.8 + rise * 0.2))}px system-ui, sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,20,0.7)'; ctx.strokeText(p.text, x, y);
        ctx.fillStyle = p.color || '#fff'; ctx.fillText(p.text, x, y);
        i++;
      }
      ctx.globalAlpha = 1;
    }

    /**
     * Draw a frame.
     * scene = {cam, track, state, skin, crashed, particles, popups, speed}
     */
    render(dt, scene) {
      this.time += dt;
      const ctx = this.ctx, { cam } = scene;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      if (this.themeFade < 1) {
        this.themeFade = Math.min(1, this.themeFade + dt / 1.2);
        this._drawBackground(ctx, cam, this.prevTheme, 1);
        this._drawBackground(ctx, cam, this.themeIndex, this.themeFade);
      } else this._drawBackground(ctx, cam, this.themeIndex, 1);
      const T = this.theme;
      if (!scene.track) return;
      this._drawTrack(ctx, cam, scene.track, T);
      this._drawHazards(ctx, cam, scene.track);
      this._drawGems(ctx, cam, scene.track);
      if (scene.particles) scene.particles.drawTrail(ctx, cam, scene.skin.trail);
      if (scene.state) this._drawBike(ctx, cam, scene.state, scene.skin, scene.crashed);
      if (scene.particles) scene.particles.draw(ctx, cam);
      // speed lines
      if (this.quality > 0 && scene.speed > 22) {
        const k = Math.min(1, (scene.speed - 22) / 8);
        ctx.strokeStyle = '#ffff'; ctx.lineWidth = 1.5;
        for (let i = 0; i < 10; i++) {
          const y = ((i * 97 + this.time * 37) % 1) * this.h, x = ((i * 389 - this.time * 2600) % this.w + this.w) % this.w;
          ctx.globalAlpha = 0.15 * k; ctx.beginPath(); ctx.moveTo(x, (i * 71) % this.h); ctx.lineTo(x + 120 * k, (i * 71) % this.h); ctx.stroke(); void y;
        }
        ctx.globalAlpha = 1;
      }
      if (scene.state) this._drawPopups(ctx, cam, scene.popups, scene.state);
    }
  }

  root.Renderer = Renderer;
  root.THEMES = THEMES;
})(typeof window !== 'undefined' ? window : globalThis);
