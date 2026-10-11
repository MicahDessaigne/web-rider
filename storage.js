// js/storage.js — localStorage persistence (key 'web-rider-v1')
(function(root) {
  const KEY = 'web-rider-v1';
  const DEFAULTS = () => ({
    bestScore: 0, bestDistance: 0, totalGems: 100, unlockedVehicles: [0], activeVehicle: 0, activeTheme: 0,
    completedChallenges: {}, levelStars: {}, dailyStreak: 0, lastDailyDate: null,
    stats: { runs: 0, totalGemsEver: 0, totalFlips: 0, totalDistance: 0 },
    settings: { soundOn: true, musicOn: true, vibrationOn: true, graphicsQuality: 'high' }, firstRun: true,
  });
  const today = () => { const d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); };
  class Storage {
    constructor() { this.state = DEFAULTS(); }
    load() {
      try {
        const raw = root.localStorage && root.localStorage.getItem(KEY);
        if (raw) {
          const p = JSON.parse(raw), d = DEFAULTS();
          this.state = Object.assign(d, p, { settings: Object.assign(d.settings, p.settings || {}), stats: Object.assign(d.stats, p.stats || {}) });
        }
      } catch (e) { this.state = DEFAULTS(); }
      return this.state;
    }
    save() { try { root.localStorage && root.localStorage.setItem(KEY, JSON.stringify(this.state)); } catch (e) {} }
    get(key) { return this.state[key]; }
    update(key, value) { this.state[key] = value; this.save(); }
    updateBest(score, distance) {
      const isBest = score > this.state.bestScore;
      if (isBest) this.state.bestScore = Math.floor(score);
      if (distance > this.state.bestDistance) this.state.bestDistance = Math.floor(distance);
      this.save(); return isBest;
    }
    addGems(n) { this.state.totalGems += n; if (n > 0) this.state.stats.totalGemsEver += n; this.save(); }
    spendGems(n) { if (this.state.totalGems < n) return false; this.state.totalGems -= n; this.save(); return true; }
    canClaimDaily() { return this.state.lastDailyDate !== today(); }
    nextDailyAmount() {
      const R = (root.CONFIG && CONFIG.DAILY_REWARDS) || [10, 15, 20, 30, 40, 50, 100];
      const y = new Date(Date.now() - 864e5), yd = y.getFullYear() + '-' + (y.getMonth() + 1) + '-' + y.getDate();
      const streak = this.state.lastDailyDate === yd ? this.state.dailyStreak + 1 : 1;
      return { streak, amount: R[(streak - 1) % R.length] };
    }
    checkDailyReward() {
      if (!this.canClaimDaily()) return 0;
      const { streak, amount } = this.nextDailyAmount();
      this.state.dailyStreak = streak; this.state.lastDailyDate = today();
      this.addGems(amount); return amount;
    }
    getSettings() { return this.state.settings; }
    setSettings(s) { this.state.settings = Object.assign(this.state.settings, s); this.save(); }
    markChallengeComplete(id) { this.state.completedChallenges[id] = true; this.save(); }
    setLevelStars(levelId, stars) { if ((this.state.levelStars[levelId] || 0) < stars) { this.state.levelStars[levelId] = stars; this.save(); } }
    isVehicleUnlocked(id) { return this.state.unlockedVehicles.includes(id); }
    unlockVehicle(id) { if (!this.isVehicleUnlocked(id)) { this.state.unlockedVehicles.push(id); this.save(); } }
    reset() { this.state = DEFAULTS(); this.save(); }
  }
  root.Storage = Storage;
  root.GameStorage = Storage;
})(typeof window !== 'undefined' ? window : globalThis);
