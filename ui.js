// js/ui.js — HTML overlay screens inside #ui-root
(function(root) {
  const SKINS = [
    { name: 'Spider', cost: 0 }, { name: 'Crimson', cost: 200 }, { name: 'Cyan', cost: 300 }, { name: 'Gold', cost: 400 },
    { name: 'Venom', cost: 500 }, { name: 'Night', cost: 600 }, { name: 'Chrome', cost: 700 }, { name: 'Magenta', cost: 800 },
    { name: 'Arctic', cost: 900 },
  ];
  const TYPE_LABELS = { flip_count: 'Flips', double_flip: 'Double Flips', triple_flip: 'Triple Flips', quad_flip: 'Quad Flips',
    distance: 'Distance', gems_one_run: 'Gems (one run)', total_gems: 'Total Gems', survive_time: 'Survival',
    perfect_landings: 'Perfect Landings', consecutive_flips: 'Flip Combos', airtime: 'Air Time', score_reach: 'Score',
    near_miss: 'Near Misses', complete_loop: 'Loops', no_crash: 'No Crash', speed_reach: 'Speed' };
  const SCREENS = ['splash', 'title', 'playing', 'paused', 'gameover', 'garage', 'levels', 'challenges', 'daily', 'settings'];
  const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  class UIManager {
    constructor() {
      this.root = document.getElementById('ui-root');
      this.game = null; this.current = null; this.screens = {};
      for (const n of SCREENS) {
        const el = document.createElement('div'); el.className = 'ui-screen screen-' + n; el.dataset.screen = n;
        this.root.appendChild(el); this.screens[n] = el;
      }
      this.root.addEventListener('click', (e) => this._onClick(e));
      this.root.addEventListener('change', (e) => this._onChange(e));
      this._hud = {};
    }
    setGame(game) { this.game = game; }
    get storage() { return this.game.storage; }
    resize(w, h) { this.root.style.setProperty('--ui-scale', Math.max(0.6, Math.min(1.3, Math.min(w / 900, h / 500))).toFixed(3)); }

    show(name) {
      const builder = this['_build_' + name]; if (builder) builder.call(this);
      for (const n of SCREENS) {
        const el = this.screens[n];
        if (n === name) { el.classList.add('active'); requestAnimationFrame(() => el.classList.add('visible')); }
        else el.classList.remove('active', 'visible');
      }
      this.current = name;
    }
    _gemBar() { return `<div class="gem-bar neon-text">💎 <span class="gem-total">${this.storage.get('totalGems')}</span></div>`; }

    _build_splash() {
      this.screens.splash.innerHTML = `<div class="center-col">
        <svg class="web-logo spin" viewBox="0 0 100 100"><g fill="none" stroke="#ff3030" stroke-width="2">
        ${[0, 1, 2, 3, 4, 5, 6, 7].map(i => `<line x1="50" y1="50" x2="${50 + 46 * Math.cos(i * Math.PI / 4)}" y2="${50 + 46 * Math.sin(i * Math.PI / 4)}"/>`).join('')}
        <circle cx="50" cy="50" r="14"/><circle cx="50" cy="50" r="28" stroke="#3060ff"/><circle cx="50" cy="50" r="42"/></g></svg>
        <h1 class="logo neon-red">WEB RIDER</h1><div class="loadbar"><div class="loadfill"></div></div></div>`;
    }
    _build_title() {
      this.screens.title.innerHTML = `${this._gemBar()}<div class="center-col">
        <h1 class="logo neon-red">WEB RIDER</h1><div class="subtitle">Best: ${this.storage.get('bestScore').toLocaleString()} · ${this.storage.get('bestDistance')}m</div>
        <div class="menu-grid">
          <button class="neon-btn primary" data-action="play">▶ PLAY ENDLESS</button>
          <button class="neon-btn" data-action="nav" data-to="levels">LEVELS</button>
          <button class="neon-btn" data-action="nav" data-to="garage">GARAGE</button>
          <button class="neon-btn" data-action="nav" data-to="challenges">CHALLENGES</button>
          <button class="neon-btn ${this.storage.canClaimDaily() ? 'pulse' : ''}" data-action="nav" data-to="daily">DAILY REWARD${this.storage.canClaimDaily() ? ' •' : ''}</button>
          <button class="neon-btn" data-action="nav" data-to="settings">SETTINGS</button>
        </div></div>`;
    }
    _build_playing() {
      const el = this.screens.playing;
      el.innerHTML = `<button class="hud-pause" data-action="pause" aria-label="Pause">||</button>
        <div class="hud-score">0</div><div class="hud-gems">💎 <span>0</span></div>
        <div class="hud-dist">0m</div><div class="hud-level"></div><div class="hud-tutorial"></div>`;
      this._hud = { score: el.querySelector('.hud-score'), gems: el.querySelector('.hud-gems span'), dist: el.querySelector('.hud-dist'),
        level: el.querySelector('.hud-level'), tut: el.querySelector('.hud-tutorial') };
      this._hudCache = {};
    }
    updateHUD(d) {
      if (!this._hud.score) return;
      const c = this._hudCache;
      if (c.score !== d.score) { this._hud.score.textContent = d.score.toLocaleString(); c.score = d.score; }
      if (c.gems !== d.gems) { this._hud.gems.textContent = d.gems; c.gems = d.gems; }
      const m = Math.floor(d.distance) + 'm' + (d.levelLength ? ' / ' + d.levelLength + 'm' : '');
      if (c.dist !== m) { this._hud.dist.textContent = m; c.dist = m; }
      if (c.level !== d.levelName) { this._hud.level.textContent = d.levelName || ''; c.level = d.levelName; }
    }
    showTutorial(ms = 3000) {
      if (!this._hud.tut) return;
      this._hud.tut.textContent = 'HOLD to accelerate • HOLD in air to FLIP';
      this._hud.tut.classList.add('show'); clearTimeout(this._tutT);
      this._tutT = setTimeout(() => this._hud.tut && this._hud.tut.classList.remove('show'), ms);
    }
    toast(text) {
      const t = document.createElement('div'); t.className = 'toast'; t.textContent = text; this.root.appendChild(t);
      setTimeout(() => t.classList.add('show'), 20); setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 400); }, 2600);
    }
    _build_paused() {
      this.screens.paused.innerHTML = `<div class="center-col panel"><h2 class="neon-red">PAUSED</h2>
        <button class="neon-btn primary" data-action="resume">RESUME</button>
        <button class="neon-btn" data-action="retry">RETRY</button>
        <button class="neon-btn" data-action="menu">MENU</button></div>`;
    }
    showGameOver(d) {
      this.show('gameover');
      const lvl = d.level;
      const stars = lvl ? `<div class="stars big">${[1, 2, 3].map(i => `<span class="${i <= d.stars ? 'on' : ''}">★</span>`).join('')}</div>` : '';
      const ch = (d.challenges || []).map(c => `<div class="ch-done">✔ ${esc(c.name)} +${c.reward}💎</div>`).join('');
      this.screens.gameover.innerHTML = `<div class="center-col panel wide">
        <h2 class="${d.finished ? 'neon-blue' : 'neon-red'}">${d.finished ? 'LEVEL COMPLETE!' : 'WIPEOUT!'}</h2>
        ${lvl ? `<div class="subtitle">Level ${lvl.id}: ${esc(lvl.name)}</div>` : ''}${stars}
        <div class="go-score neon-text">0</div>${d.isNewBest ? '<div class="new-best">NEW BEST!</div>' : ''}
        <div class="go-stats"><div><b>${d.best.toLocaleString()}</b><span>BEST</span></div><div><b>${Math.floor(d.distance)}m</b><span>DISTANCE</span></div>
          <div><b>💎 ${d.gems}</b><span>GEMS</span></div><div><b>${d.stunts}</b><span>STUNTS</span></div></div>${ch}
        <div class="row"><button class="neon-btn primary" data-action="retry">RETRY</button>
          ${lvl ? (d.finished && lvl.id < 32 ? '<button class="neon-btn" data-action="nextLevel">NEXT LEVEL</button>' : '') : '<button class="neon-btn" data-action="newTrack">NEW TRACK</button>'}
          <button class="neon-btn" data-action="menu">MENU</button></div></div>`;
      const el = this.screens.gameover.querySelector('.go-score'), t0 = performance.now(), target = d.score;
      const tick = (now) => { const k = Math.min(1, (now - t0) / 1100); el.textContent = Math.floor(target * (1 - Math.pow(1 - k, 3))).toLocaleString(); if (k < 1 && this.current === 'gameover') requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    }
    _build_garage() {
      const s = this.storage, V = CONFIG.VEHICLES;
      this.screens.garage.innerHTML = `${this._gemBar()}<div class="scroll-col"><h2 class="neon-red">GARAGE</h2><div class="card-grid g3">
        ${SKINS.map((sk, i) => {
          const owned = s.isVehicleUnlocked(i), eq = s.get('activeVehicle') === i, afford = s.get('totalGems') >= sk.cost, v = V[i] || V[0];
          const state = eq ? '<span class="tag eq">EQUIPPED</span>' : owned ? `<button class="neon-btn small" data-action="equip" data-id="${i}">EQUIP</button>`
            : afford ? `<button class="neon-btn small primary" data-action="buy" data-id="${i}">BUY 💎${sk.cost}</button>` : `<span class="tag locked">🔒 LOCKED · 💎${sk.cost}</span>`;
          return `<div class="card ${eq ? 'equipped' : ''}"><div class="swatch" style="background:linear-gradient(135deg,${v.body},${v.suit2});box-shadow:0 0 14px ${v.trail}"></div>
            <div class="card-name">${sk.name}</div><div class="card-sub">Torque ×${v.torque.toFixed(2)} · Spin ×${v.spin.toFixed(2)}</div>${state}</div>`;
        }).join('')}</div><button class="neon-btn back" data-action="menu">← BACK</button></div>`;
    }
    _build_levels() {
      const stars = this.storage.get('levelStars');
      let unlocked = 1; while (unlocked < 32 && stars[unlocked]) unlocked++;
      this.screens.levels.innerHTML = `${this._gemBar()}<div class="scroll-col"><h2 class="neon-red">LEVELS</h2><div class="card-grid g8">
        ${LEVELS.map(l => { const st = stars[l.id] || 0, lock = l.id > unlocked;
          return `<button class="level-card ${lock ? 'locked' : ''}" ${lock ? 'disabled' : `data-action="level" data-id="${l.id}"`} title="${esc(l.name)}">
            <div class="lvl-num">${lock ? '🔒' : l.id}</div><div class="lvl-name">${esc(l.name)}</div>
            <div class="stars">${[1, 2, 3].map(i => `<span class="${i <= st ? 'on' : ''}">★</span>`).join('')}</div></button>`; }).join('')}
        </div><button class="neon-btn back" data-action="menu">← BACK</button></div>`;
    }
    _build_challenges() {
      const tr = this.game.challenges, groups = {};
      CHALLENGES.forEach(c => (groups[c.type] = groups[c.type] || []).push(c));
      const done = CHALLENGES.filter(c => this.storage.get('completedChallenges')[c.id]).length;
      this.screens.challenges.innerHTML = `${this._gemBar()}<div class="scroll-col"><h2 class="neon-red">CHALLENGES <small>${done}/100</small></h2>
        ${Object.keys(groups).map(t => `<h3 class="group-title">${TYPE_LABELS[t] || t}</h3>${groups[t].map(c => {
          const p = tr.getProgress(c.id), pct = Math.round(100 * p.current / p.target);
          return `<div class="ch-row ${p.done ? 'done' : ''}"><div class="ch-icon">${c.icon}</div><div class="ch-body"><div class="ch-name">${esc(c.name)}</div>
            <div class="ch-desc">${esc(c.description)}</div><div class="pbar"><div style="width:${p.done ? 100 : pct}%"></div></div></div>
            <div class="ch-reward">${p.done ? '<span class="badge">✔</span>' : '💎' + c.reward}</div></div>`; }).join('')}`).join('')}
        <button class="neon-btn back" data-action="menu">← BACK</button></div>`;
    }
    _build_daily() {
      const s = this.storage, can = s.canClaimDaily(), nx = s.nextDailyAmount(), R = CONFIG.DAILY_REWARDS;
      const streak = can ? nx.streak : s.get('dailyStreak');
      this.screens.daily.innerHTML = `${this._gemBar()}<div class="center-col panel"><h2 class="neon-red">DAILY REWARD</h2>
        <div class="subtitle">Streak: ${s.get('dailyStreak')} day${s.get('dailyStreak') === 1 ? '' : 's'}</div>
        <div class="daily-row">${R.map((r, i) => `<div class="day ${i === (streak - 1) % 7 ? 'today' : ''} ${(!can && i <= (streak - 1) % 7) || (can && i < (streak - 1) % 7) ? 'got' : ''}"><span>Day ${i + 1}</span><b>💎${r}</b></div>`).join('')}</div>
        <div class="go-score neon-text">${can ? '💎 ' + nx.amount : 'Come back tomorrow!'}</div>
        <button class="neon-btn primary" data-action="claim" ${can ? '' : 'disabled'}>${can ? 'CLAIM' : 'CLAIMED'}</button>
        <button class="neon-btn back" data-action="menu">← BACK</button></div>`;
    }
    _build_settings() {
      const st = this.storage.getSettings(), tg = (k, label) => `<label class="toggle"><span>${label}</span><input type="checkbox" data-setting="${k}" ${st[k] ? 'checked' : ''}><i></i></label>`;
      this.screens.settings.innerHTML = `<div class="center-col panel"><h2 class="neon-red">SETTINGS</h2>
        ${tg('soundOn', 'Sound')}${tg('musicOn', 'Music')}${tg('vibrationOn', 'Vibration')}
        <label class="toggle"><span>Graphics</span><select data-setting="graphicsQuality">${['low', 'medium', 'high'].map(q => `<option value="${q}" ${st.graphicsQuality === q ? 'selected' : ''}>${q.toUpperCase()}</option>`).join('')}</select></label>
        <button class="neon-btn danger" data-action="reset">RESET PROGRESS</button>
        <button class="neon-btn back" data-action="menu">← BACK</button></div>`;
    }

    _onChange(e) {
      const k = e.target.dataset.setting; if (!k) return;
      const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
      this.storage.setSettings({ [k]: v }); this.game.applySettings();
    }
    _onClick(e) {
      const b = e.target.closest('[data-action]'); if (!b || b.disabled) return;
      const g = this.game, a = b.dataset.action, id = +b.dataset.id;
      g.audio.unlock(); g.audio.click();
      switch (a) {
        case 'play': g.startEndless(); break;
        case 'nav': this.show(b.dataset.to); break;
        case 'menu': g.goToMenu(); break;
        case 'pause': g.pause(); break;
        case 'resume': g.resume(); break;
        case 'retry': g.retry(); break;
        case 'newTrack': g.newTrack(); break;
        case 'nextLevel': g.startLevel(g.currentLevel + 1); break;
        case 'level': g.startLevel(id); break;
        case 'buy': if (this.storage.spendGems(SKINS[id].cost)) { this.storage.unlockVehicle(id); this.storage.update('activeVehicle', id); g.audio.jingle(); } this.show('garage'); break;
        case 'equip': this.storage.update('activeVehicle', id); this.show('garage'); break;
        case 'claim': { const n = this.storage.checkDailyReward(); if (n) { g.audio.jingle(); this.toast('+' + n + ' gems!'); } this.show('daily'); break; }
        case 'reset': if (confirm('Reset ALL progress? This cannot be undone.')) { this.storage.reset(); this.storage.update('firstRun', false); g.applySettings(); this.toast('Progress reset'); this.show('settings'); } break;
      }
    }
  }
  root.UIManager = UIManager;
  root.GARAGE_SKINS = SKINS;
})(typeof window !== 'undefined' ? window : globalThis);
