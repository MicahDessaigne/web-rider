// js/camera.js — Smooth follow camera.
// The bike is kept at CONFIG.CAMERA_BIKE_X of the screen width (≈30% from the left → 70% of the
// screen shows the track ahead). World scale is relative to screen WIDTH so the bike always takes
// ≈7% of the screen width on every device. Zooms out with speed and during big air.
(function (root) {
  class Camera {
    constructor() {
      this.x = 0; this.y = 0;          // world point mapped to the bike anchor
      this.zoom = 1; this.targetZoom = 1;
      this.w = 1000; this.h = 600;
      this.baseScale = CONFIG.PHYSICS_SCALE;
      this.shakeAmt = 0; this.shakeX = 0; this.shakeY = 0;
      this.anchorX = CONFIG.CAMERA_BIKE_X; this.anchorY = CONFIG.CAMERA_BIKE_Y;
    }

    resize(w, h) {
      this.w = w; this.h = h;
      // width-relative scale; guard extremely short (landscape phone) screens so jumps stay visible
      const byWidth = CONFIG.PHYSICS_SCALE * w / CONFIG.REFERENCE_WIDTH;
      const byHeight = h / 11; // at least ~11 m of vertical world visible
      this.baseScale = Math.max(8, Math.min(byWidth, byHeight * 1.35));
    }

    get scale() { return this.baseScale * this.zoom; }

    /** Snap instantly (spawn / revive). */
    reset(x, y) {
      this.x = x; this.y = y; this.zoom = 1; this.targetZoom = 1; this.shakeAmt = 0;
    }

    /**
     * @param {number} dt frame delta (s)
     * @param {{x,y}} pos interpolated bike position
     * @param {number} speed m/s
     * @param {number} heightAboveGround m (0 when grounded)
     */
    update(dt, pos, speed, heightAboveGround = 0) {
      // Horizontal: locked tightly to the bike (frame-rate independent exponential smoothing)
      const kx = 1 - Math.exp(-dt * 25);
      const ky = 1 - Math.exp(-dt * 6);
      this.x += (pos.x - this.x) * kx;
      if (Math.abs(pos.x - this.x) > 4) this.x = pos.x - Math.sign(pos.x - this.x) * 4;
      // Vertical: look a bit toward the ground when high in the air
      const ty = pos.y - Math.min(heightAboveGround, 12) * 0.35;
      this.y += (ty - this.y) * ky;

      // Zoom: out with speed and big air
      const spd = Math.max(0, speed - 10) / 20;
      const air = Math.min(1, heightAboveGround / 10);
      this.targetZoom = 1 / (1 + CONFIG.CAMERA_ZOOM_SPEED * spd * 2 + CONFIG.CAMERA_JUMP_ZOOM * air * 2);
      const kz = 1 - Math.exp(-dt * 2.2);
      this.zoom += (this.targetZoom - this.zoom) * kz;

      // Never let the bike leave the screen vertically
      const s = this.scale;
      const sy = this.h * this.anchorY - (pos.y - this.y) * s;
      const top = this.h * 0.12, bottom = this.h * 0.88;
      if (sy < top) this.y = pos.y - (this.h * this.anchorY - top) / s;
      if (sy > bottom) this.y = pos.y - (this.h * this.anchorY - bottom) / s;

      // Shake
      if (this.shakeAmt > 0.01) {
        this.shakeX = (Math.random() * 2 - 1) * this.shakeAmt;
        this.shakeY = (Math.random() * 2 - 1) * this.shakeAmt;
        this.shakeAmt *= Math.exp(-dt * 7);
      } else { this.shakeAmt = 0; this.shakeX = this.shakeY = 0; }
    }

    shake(px) { this.shakeAmt = Math.max(this.shakeAmt, px); }

    toScreenX(x) { return (x - this.x) * this.scale + this.w * this.anchorX + this.shakeX; }
    toScreenY(y) { return this.h * this.anchorY - (y - this.y) * this.scale + this.shakeY; }
    toWorldX(sx) { return (sx - this.w * this.anchorX - this.shakeX) / this.scale + this.x; }
    toWorldY(sy) { return (this.h * this.anchorY + this.shakeY - sy) / this.scale + this.y; }

    /** Visible world range with a margin (m). */
    viewBounds(margin = 4) {
      return {
        x0: this.toWorldX(0) - margin, x1: this.toWorldX(this.w) + margin,
        y0: this.toWorldY(this.h) - margin, y1: this.toWorldY(0) + margin,
      };
    }
  }
  root.Camera = Camera;
})(typeof window !== 'undefined' ? window : globalThis);
