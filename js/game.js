/* Main game loop and connections between the existing game modules. */
(function (root) {
  'use strict';
const RIDER_STYLE_PIECES = [
  0, 1, 2, 3, 4, 5, 6, 8,          // flats, gentle terrain, bumps
  10, 11, 12, 16, 18, 20,          // ramps and kickers
  22, 23, 24, 26, 27, 28, 31,      // jumps and gem trails
  32, 33, 34,                       // drops
  40, 41, 42, 43, 44,               // loops and loop combinations
  48, 49, 50, 51, 52, 53, 54, 55,  // flowing curves and waves
  67, 68, 69, 70, 81,               // a limited set of hazards and boosts
  90, 91, 92, 93, 94, 95, 97, 98, 99 // gem patterns
];
  class Game {
    constructor() {
      this.canvas = document.getElementById('game-canvas');
      this.storage = new root.Storage();
      this.storage.load();

      this.audio = new root.AudioManager();
      this.particles = new root.ParticleSystem();
      this.renderer = new root.Renderer(this.canvas);
      this.camera = new root.Camera();
      this.input = new root.InputHandler();
      this.ui = new root.UIManager();
      this.ui.setGame(this);

      this.mode = 'menu';
      this.physics = null;
      this.track = null;
      this.vehicle = null;
      this.stunts = new root.StuntSystem(this.audio);
      this.challenges = new root.ChallengeTracker(this.storage);

      this.currentLevel = null;
      this.currentSeed = 0;
      this.runStartX = 0;
      this.gemEarned = 0;
      this.runEnded = false;
      this.crashElapsed = 0;
      this.lastTime = 0;
      this.lastCleanupStep = 0;
      this.frameHandle = 0;
      this.destroyed = false;

      this.input.init(this.canvas);
      this.input.onFirstGesture = () => this.audio.unlock();

      this.applySettings();
      this.resize();
      window.addEventListener('resize', () => this.resize());
      window.addEventListener('orientationchange', () => this.resize());
      document.addEventListener('visibilitychange', () => {
        if (document.hidden && this.mode === 'playing') this.pause();
      });
      window.addEventListener('blur', () => {
        if (this.mode === 'playing') this.pause();
      });

      this.ui.show('title');
      this.frameHandle = requestAnimationFrame((t) => this.frame(t));
    }

    resize() {
      const w = window.innerWidth;
      const h = window.innerHeight;
      this.renderer.resize(w, h);
      this.camera.resize(w, h);
      this.ui.resize(w, h);

      if (screen.orientation && screen.orientation.lock && w > h) {
        screen.orientation.lock('landscape').catch(() => {});
      }
    }

    applySettings() {
      const settings = this.storage.getSettings();
      this.audio.setSound(!!settings.soundOn);
      this.audio.setMusic(!!settings.musicOn);
      this.audio.vibration = !!settings.vibrationOn;

      const quality = settings.graphicsQuality === 'low' ? 0 :
        settings.graphicsQuality === 'medium' ? 1 : 2;
      this.renderer.setQuality(quality);
      this.particles.setQuality(quality);
    }

    startEndless() {
      this.currentLevel = null;
      this.currentSeed = Math.floor(Math.random() * 0x7fffffff);
      this.startRun();
    }

    newTrack() {
      this.currentLevel = null;
      this.currentSeed = Math.floor(Math.random() * 0x7fffffff);
      this.startRun();
    }

    startLevel(id) {
      const level = root.LEVELS.find((item) => item.id === id);
      if (!level) return;
      this.currentLevel = level;
      this.currentSeed = level.seed;
      this.startRun();
      this.renderer.setTheme(level.theme);
    }

    startRun() {
      const firstRun = !!this.storage.get('firstRun');

      this.destroyRun();
      this.physics = new root.PhysicsWorld();
      this.physics.init();

      const level = this.currentLevel;
      this.track = new root.Track(this.physics, {
        {
  seed: this.currentSeed,
  length: level ? level.length : 0,
  minDifficulty: level ? Math.max(1, level.difficulty - 1) : 1,
  maxDifficulty: level ? level.difficulty : 10,
  pool: RIDER_STYLE_PIECES,
  startFlat: 22
}
      });
      this.track.initStart();

      const spawnY = root.CONFIG.WHEEL_RADIUS -
        root.CONFIG.WHEEL_Y_OFFSET + 0.05;
      this.vehicle = new root.Vehicle(this.physics, 2, spawnY, this.track);
      const selectedVehicle =
  root.CONFIG.VEHICLES[this.storage.get('activeVehicle')] ||
  root.CONFIG.VEHICLES[0];

this.vehicle.stats = {
  torque: selectedVehicle.torque || 1,
  spin: selectedVehicle.spin || 1
};
      this.runStartX = this.vehicle.getPosition().x;

      this.stunts = new root.StuntSystem(this.audio);
      this.challenges = new root.ChallengeTracker(this.storage);
      this.gemEarned = 0;
      this.runEnded = false;
      this.crashElapsed = 0;
      this.lastCleanupStep = 0;
      this.particles.clear();

      this.track.onGem = (gem) => {
        this.gemEarned += 1;
        this.storage.addGems(1);
        this.stunts.onGemCollect();
        this.challenges.onGemCollect(this.stunts.gems);
        this.particles.gemSparkle(gem.x, gem.y);
      };
      this.track.onNearMiss = () => {
        this.stunts.onNearMiss();
        this.challenges.onNearMiss();
      };
      this.track.onBoost = () => this.audio.boost();
      this.track.onBounce = () => this.audio.bounce();
      this.track.onFinish = () => this.endRun(true);

      this.vehicle.onLand = (data) => {
        const result = this.stunts.onLand(data);
        this.challenges.onLand(Object.assign({}, data, result));
        if (result.flips) this.challenges.onFlip(result.flips);
        this.audio.land(result.perfect ? 1.3 : 0.8);
        this.particles.landing(data.x, data.y, this.renderer.theme.edge, result.perfect ? 1.5 : 1);
      };
      this.vehicle.onLoopComplete = () => {
        this.stunts.onLoop();
        this.challenges.onLoop();
      };

      this.camera.reset(this.runStartX, spawnY);
      this.mode = 'playing';
      this.ui.show('playing');
      this.audio.unlock();
      this.audio.startEngine();

      if (firstRun) {
        this.ui.showTutorial(4000);
        this.storage.update('firstRun', false);
      }
    }

    destroyRun() {
      if (this.vehicle) this.vehicle.destroy();
      if (this.track) this.track.destroy();
      if (this.physics) this.physics.destroy();
      this.vehicle = null;
      this.track = null;
      this.physics = null;
    }

    retry() {
      if (this.currentSeed) this.startRun();
      else this.startEndless();
    }

    pause() {
      if (this.mode !== 'playing') return;
      this.mode = 'paused';
      this.input.holding = false;
      this.audio.stopEngine();
      this.audio.suspend();
      this.ui.show('paused');
    }

    resume() {
      if (this.mode !== 'paused') return;
      this.mode = 'playing';
      this.audio.unlock();
      this.audio.resume();
      this.audio.startEngine();
      this.ui.show('playing');
    }

    goToMenu() {
      this.mode = 'menu';
      this.input.holding = false;
      this.audio.stopEngine();
      this.destroyRun();
      this.ui.show('title');
    }

    endRun(finished) {
      if (this.runEnded) return;
      this.runEnded = true;
      this.mode = 'results';
      this.audio.stopEngine();

      const distance = Math.max(0, this.vehicle.getPosition().x - this.runStartX);
      this.stunts.addDistance(distance);
      this.challenges.onDistance(distance);
      this.challenges.onTime(this.vehicle.age);
      this.challenges.onScore(this.stunts.getScore());
      const newlyCompleted = this.challenges.finalize();
      const score = this.stunts.getScore();
      const isNewBest = this.storage.updateBest(score, distance);

      const stats = this.storage.get('stats');
      stats.runs += 1;
      stats.totalFlips += this.stunts.totalFlips;
      stats.totalDistance += Math.floor(distance);
      this.storage.save();

      let stars = 0;
      if (finished && this.currentLevel) {
        stars = 1;
        if (this.gemEarned >= 3 || this.stunts.totalFlips >= 3) stars = 2;
        if (this.gemEarned >= 8 && this.stunts.totalFlips >= 6) stars = 3;
        this.storage.setLevelStars(this.currentLevel.id, stars);
      }

      this.ui.showGameOver({
        finished: !!finished,
        level: this.currentLevel,
        stars,
        score,
        best: this.storage.get('bestScore'),
        distance,
        gems: this.gemEarned,
        stunts: this.stunts.stuntCount,
        isNewBest,
        challenges: newlyCompleted
      });
    }

    updateSimulation(dt) {
      if (!this.physics || !this.vehicle || this.mode !== 'playing') return;

      this.physics.step(dt,
        () => {
          this.vehicle.holding = this.input.holding;
          this.vehicle.beforeStep(root.CONFIG.FIXED_DT);
        },
        (fixedDt) => {
          this.vehicle.afterStep(fixedDt);
          this.track.update(fixedDt, this.vehicle);

          const pos = this.vehicle.getPosition();
          const distance = Math.max(0, pos.x - this.runStartX);
          const speed = this.vehicle.getSpeed();

          this.stunts.addDistance(distance);
          this.challenges.onDistance(distance);
          this.challenges.onTime(this.vehicle.age);
          this.challenges.onSpeed(speed);
          this.challenges.onScore(this.stunts.getScore());

          if (this.currentLevel) {
            this.renderer.setTheme(this.currentLevel.theme);
          } else {
            const themeIndex = Math.floor(distance / root.CONFIG.THEME_LENGTH) % root.THEMES.length;
            this.renderer.setTheme(themeIndex);
          }

          if (this.physics.stepCount - this.lastCleanupStep >= 64) {
            this.track.ensureGeneratedAhead(pos.x);
            this.track.cleanupBehind(pos.x);
            this.lastCleanupStep = this.physics.stepCount;
          }

          if (this.vehicle.crashed && !this.runEnded) {
            this.crashElapsed += fixedDt;
            if (this.crashElapsed === fixedDt) {
              this.particles.crashBurst(pos.x, pos.y, ['#ff304f', '#ff9b38', '#fff']);
              this.camera.shake(12);
              this.audio.crash();
              this.audio.vibrate(180);
            }
            if (this.crashElapsed >= 0.7) this.endRun(false);
          }
        }
      );
    }

    render(dt) {
      if (this.mode === 'playing' || this.mode === 'results') {
        if (this.vehicle && this.track) {
          const pos = this.vehicle.getPosition();
          const groundY = this.track.getGroundYAt(pos.x, pos.y);
          const height = groundY === null ? 0 : Math.max(0, pos.y - groundY);
          this.camera.update(dt, pos, this.vehicle.getSpeed(), height);
          this.particles.update(dt);

          const skin = root.CONFIG.VEHICLES[
            this.storage.get('activeVehicle')
          ] || root.CONFIG.VEHICLES[0];

          const state = {
            x: pos.x,
            y: pos.y,
            a: this.vehicle.getAngle(),
            fx: this.vehicle.getFrontWheelPos().x,
            fy: this.vehicle.getFrontWheelPos().y,
            fa: this.vehicle.getFrontWheelAngle(),
            rx: this.vehicle.getRearWheelPos().x,
            ry: this.vehicle.getRearWheelPos().y,
            ra: this.vehicle.getRearWheelAngle()
          };

          this.renderer.render(dt, {
            cam: this.camera,
            track: this.track,
            state,
            skin,
            crashed: this.vehicle.crashed,
            particles: this.particles,
            popups: this.stunts.popups,
            speed: this.vehicle.getSpeed()
          });

          const distance = Math.max(0, pos.x - this.runStartX);
          if (this.mode === 'playing') {
            this.ui.updateHUD({
              score: this.stunts.getScore(),
              gems: this.stunts.gems,
              distance,
              levelLength: this.currentLevel ? this.currentLevel.length : 0,
              levelName: this.currentLevel ? this.currentLevel.name : ''
            });
          }
        }
      } else {
        this.renderer.render(dt, { cam: this.camera });
      }
    }

    frame(now) {
      if (this.destroyed) return;
      const dt = Math.min(0.05, Math.max(0, (now - (this.lastTime || now)) / 1000));
      this.lastTime = now;

      this.updateSimulation(dt);
      this.stunts.update(dt);
      this.render(dt);
      this.input.clearEdgeEvents();

      this.frameHandle = requestAnimationFrame((t) => this.frame(t));
    }
  }

  root.Game = Game;
  new Game();
})(window);
