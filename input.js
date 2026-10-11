(function(root) {
  class InputHandler {
    constructor() {
      this.holding = false; this.justPressed = false; this.justReleased = false;
      this._boundKeyDown = this._onKeyDown.bind(this); this._boundKeyUp = this._onKeyUp.bind(this);
      this.onFirstGesture = null;
    }
    _press() { if (!this.holding) this.justPressed = true; this.holding = true; if (this.onFirstGesture) this.onFirstGesture(); }
    _release() { if (this.holding) this.justReleased = true; this.holding = false; }
    init(canvas) {
      canvas.addEventListener('touchstart', (e) => { e.preventDefault(); this._press(); }, { passive: false });
      canvas.addEventListener('touchend', (e) => { e.preventDefault(); if (e.touches.length === 0) this._release(); }, { passive: false });
      canvas.addEventListener('touchcancel', (e) => { e.preventDefault(); this.holding = false; }, { passive: false });
      canvas.addEventListener('mousedown', () => this._press());
      window.addEventListener('mouseup', () => this._release());
      window.addEventListener('keydown', this._boundKeyDown);
      window.addEventListener('keyup', this._boundKeyUp);
      window.addEventListener('blur', () => { this.holding = false; });
      canvas.addEventListener('contextmenu', (e) => e.preventDefault());
      document.addEventListener('selectstart', (e) => e.preventDefault());
    }
    _onKeyDown(e) { if (e.code === 'Space' || e.code === 'ArrowUp') { e.preventDefault(); if (!e.repeat) this._press(); } }
    _onKeyUp(e) { if (e.code === 'Space' || e.code === 'ArrowUp') { e.preventDefault(); this._release(); } }
    clearEdgeEvents() { this.justPressed = false; this.justReleased = false; }
    destroy() { window.removeEventListener('keydown', this._boundKeyDown); window.removeEventListener('keyup', this._boundKeyUp); }
  }
  root.InputHandler = InputHandler;
})(typeof window !== 'undefined' ? window : globalThis);
