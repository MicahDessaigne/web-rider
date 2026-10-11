// js/challenges.js — 100 challenges + per-run tracker
(function(root) {
  // [type, icon, name template, description template, targets[]]
  const DEFS = [
    ['flip_count', '🔄', 'Flipper', 'Land {t} flips in one run', [1, 3, 5, 10, 15, 20, 30, 40, 50]],
    ['double_flip', '⚡', 'Double Up', 'Land {t} double flip(s) in one run', [1, 2, 3, 5, 8, 12]],
    ['triple_flip', '🌀', 'Triple Threat', 'Land {t} triple flip(s) in one run', [1, 2, 3, 5, 8]],
    ['quad_flip', '💥', 'Quad God', 'Land {t} quad flip(s) in one run', [1, 2, 3, 4]],
    ['distance', '🛣️', 'Web Runner', 'Ride {t}m in one run', [100, 200, 300, 500, 750, 1000, 1500, 2000, 3000, 5000]],
    ['gems_one_run', '💎', 'Gem Grabber', 'Collect {t} gems in one run', [5, 10, 20, 30, 50, 75, 100]],
    ['total_gems', '👜', 'Gem Hoarder', 'Collect {t} gems in total', [50, 100, 250, 500, 1000, 2000, 5000]],
    ['survive_time', '⏱️', 'Survivor', 'Survive {t} seconds in one run', [30, 60, 90, 120, 180, 300]],
    ['perfect_landings', '🎯', 'Sticky Feet', 'Make {t} perfect landings in one run', [1, 3, 5, 10, 15, 25]],
    ['consecutive_flips', '🔥', 'Combo King', 'Land flips on {t} jumps in a row', [2, 3, 4, 5, 7, 10]],
    ['airtime', '🪂', 'Hang Time', 'Stay airborne {t}s in a single jump', [1, 1.5, 2, 2.5, 3, 4]],
    ['score_reach', '🏆', 'High Scorer', 'Score {t} points in one run', [1000, 2500, 5000, 10000, 20000, 35000, 50000, 75000, 100000]],
    ['near_miss', '😱', 'Close Call', 'Get {t} near misses in one run', [1, 3, 5, 10, 20]],
    ['complete_loop', '➰', 'Loop the Loop', 'Complete {t} loop(s) in one run', [1, 2, 3, 5, 8]],
    ['no_crash', '🛡️', 'Untouchable', 'Ride {t}m without crashing', [250, 500, 1000, 2000]],
    ['speed_reach', '🚀', 'Speed Demon', 'Reach {t} km/h', [50, 65, 75, 85, 95]],
  ];
  const CHALLENGES = [];
  DEFS.forEach(([type, icon, name, desc, targets]) => targets.forEach((t, i) => {
    const frac = (i + 1) / targets.length;
    CHALLENGES.push({ id: type + '_' + (i + 1), name: name + ' ' + ['I','II','III','IV','V','VI','VII','VIII','IX','X'][i],
      description: desc.replace('{t}', t.toLocaleString('en-US')), type, target: t, icon,
      reward: Math.min(500, Math.max(10, Math.round((10 + frac * frac * 450) / 5) * 5)) });
  }));
  if (CHALLENGES.length !== 100) console.warn('CHALLENGES count', CHALLENGES.length);

  class ChallengeTracker {
    constructor(storage) { this.storage = storage; this.newlyCompleted = []; this.reset(); }
    reset() {
      this.run = { flip_count: 0, double_flip: 0, triple_flip: 0, quad_flip: 0, distance: 0, gems_one_run: 0,
        survive_time: 0, perfect_landings: 0, consecutive_flips: 0, airtime: 0, score_reach: 0, near_miss: 0,
        complete_loop: 0, no_crash: 0, speed_reach: 0 };
      this._consec = 0; this.newlyCompleted = [];
    }
    onFlip(count) {
      this.run.flip_count += count;
      if (count === 2) this.run.double_flip++; if (count === 3) this.run.triple_flip++; if (count >= 4) this.run.quad_flip++;
      if (count > 0) { this._consec++; this.run.consecutive_flips = Math.max(this.run.consecutive_flips, this._consec); }
      this._check();
    }
    onGemCollect(total) { this.run.gems_one_run = total; this._check(); }
    onDistance(m) { this.run.distance = Math.max(this.run.distance, m); this.run.no_crash = this.run.distance; }
    onTime(s) { this.run.survive_time = s; }
    onSpeed(ms) { this.run.speed_reach = Math.max(this.run.speed_reach, ms * 3.6); }
    onNearMiss() { this.run.near_miss++; }
    onLoop() { this.run.complete_loop++; }
    onLand(data) {
      this.run.airtime = Math.max(this.run.airtime, data.airTime || 0);
      if (data.perfect) this.run.perfect_landings++;
      if (!data.flips && data.airTime > 0.6) this._consec = 0;
      this._check();
    }
    onScore(s) { this.run.score_reach = Math.max(this.run.score_reach, s); }
    _current(c) {
      if (c.type === 'total_gems') return (this.storage.get('stats').totalGemsEver || 0);
      return this.run[c.type] || 0;
    }
    getProgress(id) {
      const c = CHALLENGES.find(x => x.id === id); if (!c) return null;
      const done = !!this.storage.get('completedChallenges')[id];
      return { current: done ? c.target : Math.min(c.target, this._current(c)), target: c.target, done };
    }
    _check() {
      const doneMap = this.storage.get('completedChallenges');
      for (const c of CHALLENGES) if (!doneMap[c.id] && this._current(c) >= c.target) this.complete(c.id, this.storage);
    }
    /** Call at end of run (and periodically) to award anything newly reached. */
    finalize() { this._check(); return this.newlyCompleted; }
    complete(id, storage) {
      const c = CHALLENGES.find(x => x.id === id); if (!c || storage.get('completedChallenges')[id]) return false;
      storage.markChallengeComplete(id); storage.addGems(c.reward); this.newlyCompleted.push(c);
      if (this.onComplete) this.onComplete(c);
      return true;
    }
  }
  root.CHALLENGES = CHALLENGES;
  root.ChallengeTracker = ChallengeTracker;
})(typeof window !== 'undefined' ? window : globalThis);
