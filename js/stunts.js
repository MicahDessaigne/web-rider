// js/stunts.js — scoring, flip detection and floating stunt popups
(function(root) {
  const PHRASES = {
    single: ['nice flipping!', 'smooth spin!', 'solid flip!', 'clean rotation!', 'good flip!', 'one flip!'],
    double: ['double flip!', 'nice double!', '2x rotation!', 'great combo!', 'acing it!', 'double trouble!'],
    triple: ['flawless triple spin!', 'triple flip!', '3 spins!', 'unstoppable!', 'triple threat!', 'hat trick!'],
    quad:   ['QUAD FLIP!', 'quad master!', '4 ROTATIONS!', 'INSANE!', 'GOD MODE!', 'LEGENDARY!'],
    perfect:['perfect landing!', 'flawless!', 'smooth landing!', 'textbook!', 'pixel perfect!', 'silky!'],
    air:    ['big air!', 'hang time!', 'sky high!', 'soaring!', 'altitude!'],
    streak: ['on a streak!', 'combo!', 'flipmaestro!', 'flip maestro!', 'unreal!', 'wow!', 'incredible!', 'unstoppable streak!'],
  };
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  class StuntSystem {
    constructor(audio) { this.audio = audio || null; this.reset(); }
    reset() {
      this.score = 0; this.bonusScore = 0; this.distance = 0; this.gems = 0;
      this.consecutiveFlips = 0; this.landingStreak = 0; this.popups = []; this.gemChainCount = 0; this._lastGemT = -9;
      this.time = 0; this.totalFlips = 0; this.stuntCount = 0; this.perfectLandings = 0; this.maxAirTime = 0;
      this.maxFlipsOneJump = 0; this.nearMisses = 0; this.loops = 0; this.maxConsecutive = 0;
    }
    onLand(data) {
      const C = root.CONFIG;
      const flips = Math.floor(Math.abs(data.totalRotation) / (Math.PI * 2) + 0.15);
      const relDeg = Math.abs((data.relativeAngle || 0) * 180 / Math.PI);
      const perfect = relDeg < C.PERFECT_LANDING_DEG && data.airTime > 0.35;
      let pts = 0;
      if (data.airTime > this.maxAirTime) this.maxAirTime = data.airTime;
      if (flips > 0) {
        const tier = flips >= 4 ? 'quad' : flips === 3 ? 'triple' : flips === 2 ? 'double' : 'single';
        pts += flips >= 4 ? C.SCORE_QUAD_FLIP + (flips - 4) * 800 : [0, C.SCORE_SINGLE_FLIP, C.SCORE_DOUBLE_FLIP, C.SCORE_TRIPLE_FLIP][flips];
        this.totalFlips += flips; this.stuntCount++; this.consecutiveFlips++;
        this.maxConsecutive = Math.max(this.maxConsecutive, this.consecutiveFlips);
        this.maxFlipsOneJump = Math.max(this.maxFlipsOneJump, flips);
        this.addPopup(pick(PHRASES[tier]) + ' +' + pts, ['#ffffff', '#ffffff', '#00e5ff', '#ffc93c', '#ff3df0'][Math.min(4, flips)], 0.55 + flips * 0.08);
        if (this.audio) this.audio.bonus(flips);
      } else if (data.airTime > 0.6) this.consecutiveFlips = 0;
      if (data.airTime > 1.6) { const a = Math.round(data.airTime * 60); pts += a; this.addPopup(pick(PHRASES.air) + ' +' + a, '#7fd1ff'); }
      if (perfect) {
        pts += C.SCORE_PERFECT_LDG; this.perfectLandings++; this.landingStreak++;
        this.addPopup(pick(PHRASES.perfect) + ' +' + C.SCORE_PERFECT_LDG, '#39ff14');
      } else this.landingStreak = 0;
      if (this.consecutiveFlips >= 3 && flips > 0) {
        const mult = Math.min(5, this.consecutiveFlips - 1); const b = Math.round(pts * (mult - 1) * 0.25);
        if (b > 0) { pts += b; this.addPopup(pick(PHRASES.streak) + ' x' + mult, '#ff3030', 0.6); }
      }
      this.bonusScore += pts;
      return { flips, perfect, points: pts };
    }
    onNearMiss() { this.nearMisses++; this.bonusScore += root.CONFIG.SCORE_NEAR_MISS; this.addPopup('near miss! +' + root.CONFIG.SCORE_NEAR_MISS, '#ffb000'); }
    onLoop() { this.loops++; this.bonusScore += root.CONFIG.SCORE_LOOP; this.addPopup('web loop! +' + root.CONFIG.SCORE_LOOP, '#00e5ff', 0.6); }
    onGemCollect() {
      this.gems++;
      this.gemChainCount = (this.time - this._lastGemT < 1.2) ? this.gemChainCount + 1 : 0;
      this._lastGemT = this.time;
      this.bonusScore += root.CONFIG.SCORE_GEM;
      if (this.audio) this.audio.gem(this.gemChainCount);
    }
    addDistance(meters) { if (meters > this.distance) this.distance = meters; }
    addPopup(text, color = '#fff', size = 0.55) {
      this.popups.unshift({ text, color, size, t: 0, life: 1.6 });
      if (this.popups.length > 4) this.popups.length = 4;
    }
    update(dt) {
      this.time += dt;
      for (const p of this.popups) p.t += dt;
      this.popups = this.popups.filter(p => p.t < p.life);
    }
    drawPopups(ctx, x, y) {
      this.popups.forEach((p, i) => {
        ctx.globalAlpha = Math.max(0, 1 - p.t / p.life); ctx.fillStyle = p.color; ctx.font = 'bold 22px sans-serif';
        ctx.textAlign = 'center'; ctx.fillText(p.text, x, y - 60 - i * 26 - p.t * 20);
      });
      ctx.globalAlpha = 1;
    }
    getScore() { return Math.floor(this.distance * root.CONFIG.SCORE_PER_METER + this.bonusScore); }
  }
  root.StuntSystem = StuntSystem;
  root.STUNT_PHRASES = PHRASES;
})(typeof window !== 'undefined' ? window : globalThis);
