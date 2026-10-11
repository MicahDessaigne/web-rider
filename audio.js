// js/audio.js — Procedural Web Audio: engine, SFX and a looping synthwave track. No audio files.
(function (root) {
  class AudioManager {
    constructor() {
      this.ctx = null; this.sound = true; this.music = true; this.volume = 0.8;
      this.engine = null; this.musicTimer = null; this.nextNote = 0; this.step = 0;
    }

    /** Must be called from a user gesture (iOS). */
    unlock() {
      try {
        if (!this.ctx) {
          const AC = root.AudioContext || root.webkitAudioContext;
          if (!AC) return;
          this.ctx = new AC();
          this.master = this.ctx.createGain(); this.master.connect(this.ctx.destination);
          this.sfx = this.ctx.createGain(); this.sfx.connect(this.master);
          this.mus = this.ctx.createGain(); this.mus.gain.value = 0.35; this.mus.connect(this.master);
          this._noise = this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate);
          const d = this._noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
          this._apply();
        }
        if (this.ctx.state === 'suspended') this.ctx.resume();
        // iOS: play a silent buffer inside the gesture
        const b = this.ctx.createBufferSource(); b.buffer = this.ctx.createBuffer(1, 1, 22050); b.connect(this.ctx.destination); b.start(0);
        if (this.music) this.startMusic();
      } catch (e) { this.ctx = null; }
    }

    _apply() {
      if (!this.ctx) return;
      this.master.gain.value = this.volume;
      this.sfx.gain.value = this.sound ? 1 : 0;
      this.mus.gain.value = this.music ? 0.35 : 0;
    }
    setSound(on) { this.sound = on; this._apply(); if (!on) this.stopEngine(); }
    setMusic(on) { this.music = on; this._apply(); if (on) this.startMusic(); else this.stopMusic(); }
    setVolume(v) { this.volume = v; this._apply(); }
    suspend() { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend(); }
    resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

    _tone(freq, dur, type = 'sine', vol = 0.3, when = 0, slideTo = 0, dest) {
      if (!this.ctx) return;
      const t = this.ctx.currentTime + when;
      const o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, t);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(dest || this.sfx); o.start(t); o.stop(t + dur + 0.05);
    }
    _noiseBurst(dur, vol, f0, f1, type = 'lowpass', when = 0, dest) {
      if (!this.ctx) return;
      const t = this.ctx.currentTime + when;
      const s = this.ctx.createBufferSource(); s.buffer = this._noise;
      const f = this.ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
      const g = this.ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      s.connect(f); f.connect(g); g.connect(dest || this.sfx); s.start(t); s.stop(t + dur + 0.05);
    }

    // ── Engine hum (two detuned oscillators through a low-pass) ──
    startEngine() {
      if (!this.ctx || this.engine || !this.sound) return;
      const o1 = this.ctx.createOscillator(), o2 = this.ctx.createOscillator(), f = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
      o1.type = 'sawtooth'; o2.type = 'square'; o2.detune.value = 7; f.type = 'lowpass'; f.frequency.value = 600; g.gain.value = 0;
      o1.connect(f); o2.connect(f); f.connect(g); g.connect(this.sfx); o1.start(); o2.start();
      this.engine = { o1, o2, f, g };
    }
    updateEngine(speed, throttle) {
      if (!this.engine) return;
      const t = this.ctx.currentTime, base = 45 + speed * 4.5 + (throttle ? 15 : 0);
      this.engine.o1.frequency.setTargetAtTime(base, t, 0.05);
      this.engine.o2.frequency.setTargetAtTime(base * 0.5, t, 0.05);
      this.engine.f.frequency.setTargetAtTime(300 + speed * 40 + (throttle ? 400 : 0), t, 0.08);
      this.engine.g.gain.setTargetAtTime(throttle ? 0.07 : 0.035, t, 0.1);
    }
    stopEngine() {
      if (!this.engine) return;
      const e = this.engine; this.engine = null;
      try { e.g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05); e.o1.stop(this.ctx.currentTime + 0.3); e.o2.stop(this.ctx.currentTime + 0.3); } catch (err) { /* already stopped */ }
    }

    gem(chain = 0) { const f = 880 * Math.pow(2, Math.min(chain, 12) / 12); this._tone(f, 0.12, 'triangle', 0.25); this._tone(f * 1.5, 0.15, 'sine', 0.12, 0.04); }
    whoosh() { this._noiseBurst(0.3, 0.25, 400, 3000, 'bandpass'); }
    land(strength = 1) { this._tone(120, 0.18, 'sine', 0.35 * Math.min(1.5, strength), 0, 50); this._noiseBurst(0.12, 0.2, 800, 100); }
    crash() { this._noiseBurst(0.8, 0.6, 3000, 60); this._tone(90, 0.6, 'sawtooth', 0.4, 0, 30); this._tone(60, 0.8, 'sine', 0.5, 0.05, 25); }
    click() { this._tone(1200, 0.05, 'square', 0.12); }
    bonus(level = 1) { [0, 4, 7, 12].slice(0, 1 + Math.min(3, level)).forEach((n, i) => this._tone(660 * Math.pow(2, n / 12), 0.14, 'triangle', 0.2, i * 0.06)); }
    boost() { this._tone(300, 0.35, 'sawtooth', 0.15, 0, 900); }
    bounce() { this._tone(200, 0.25, 'sine', 0.3, 0, 600); }
    jingle() { [0, 4, 7, 12, 16, 19, 24].forEach((n, i) => this._tone(523 * Math.pow(2, n / 12), 0.25, 'triangle', 0.22, i * 0.09)); }
    vibrate(ms) { if (this.vibration && root.navigator && navigator.vibrate) try { navigator.vibrate(ms); } catch (e) { /* unsupported */ } }

    // ── Synthwave loop: bass arpeggio + pad + hats, scheduled ahead ──
    startMusic() {
      if (!this.ctx || this.musicTimer || !this.music) return;
      this.nextNote = this.ctx.currentTime + 0.1; this.step = 0;
      const prog = [[45, 52, 57, 60], [41, 48, 53, 57], [43, 50, 55, 59], [40, 47, 52, 55]];
      const bpm = 108, s16 = 60 / bpm / 4;
      const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
      this.musicTimer = setInterval(() => {
        if (!this.ctx || this.ctx.state !== 'running') return;
        while (this.nextNote < this.ctx.currentTime + 0.3) {
          const bar = Math.floor(this.step / 16) % 4, st = this.step % 16, ch = prog[bar], when = this.nextNote - this.ctx.currentTime;
          this._tone(mtof(ch[st % 4] - 12), s16 * 0.9, 'sawtooth', 0.09, when, 0, this.mus);
          if (st % 4 === 2) this._noiseBurst(0.05, 0.05, 9000, 6000, 'highpass', when, this.mus);
          if (st % 8 === 0) this._tone(55, 0.25, 'sine', 0.25, when, 35, this.mus);
          if (st === 0) ch.forEach(n => this._tone(mtof(n + 12), s16 * 15, 'triangle', 0.025, when, 0, this.mus));
          this.nextNote += s16; this.step++;
        }
      }, 100);
    }
    stopMusic() { clearInterval(this.musicTimer); this.musicTimer = null; }
  }
  root.AudioManager = AudioManager;
})(typeof window !== 'undefined' ? window : globalThis);
