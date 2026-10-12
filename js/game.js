/* Main game loop and connections between the existing game modules. */
(function (root) {
  'use strict';

  // Restrict procedural tracks to the existing piece IDs that emphasize
  // flowing terrain, jumps, loops, hazards, boosts, and gem trails.
  const RIDER_STYLE_PIECES = [
    0, 1, 2, 3, 4, 5, 6, 8,
    10, 11, 12, 16, 18, 20,
    22, 23, 24, 26, 27, 28, 31,
    32, 33, 34,
    40, 41, 42, 43, 44,
    48, 49, 50, 51, 52, 53, 54, 55,
    67, 68, 69, 70, 81,
    90, 91, 92, 93, 94, 95, 97, 98, 99
  ];

  class Game {
    constructor() {
      this.canvas = document.getElementById('game-canvas');
      if (!this.canvas) {
        throw new Error('The #game-canvas element is missing from index.html.');
      }

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
      this.currentSeed = null;
      this.runStartX = 0;
      this.gemEarned = 0;
      this.runEnded = false;
      this.crashElapsed = 0;
      this.crashEffectsPlayed = false;

      this.lastTime = 0;
      this.lastCleanupStep = 0;
      this.frameHandle = 0;
      this.destroyed = false;

      this.input.init(this.canvas);
      this.input.onFirstGesture = () => this.audio.unlock();

      this.applySettings();
      this.resize();

      this._onResize = () => this.resize();
      this._onVisibilityChange = () => {
        if (document.hidden && this.mode === 'playing') this.pause();
        // Avoid a large simulation delta when the tab becomes visible again.
        this.lastTime = 0;
      };
      this._onBlur = () => {
        if (this.mode === 'playing') this.pause();
      };

      window.addEventListener('resize', this._onResize);
      window.addEventListener('orientationchange', this._onResize);
      window.addEventListener('blur', this._onBlur);
      document.addEventListener('visibilitychange', this._onVisibilityChange);

      this.ui.show('title');
      this.frameHandle = requestAnimationFrame((time) => this.frame(time));
    }

    resize() {
      const width = window.innerWidth;
      const height = window.innerHeight;

      this.renderer.resize(width, height);
      this.camera.resize(width, height);
      this.ui.resize(width, height);

      const orientation = root.screen && root.screen.orientation;
      if (width > height && orientation && typeof orientation.lock === 'function') {
        orientation.lock('landscape').catch(() => {});
      }
    }

    applySettings() {
      const settings = this.storage.getSettings();

      this.audio.setSound(!!settings.soundOn);
      this.audio.setMusic(!!settings.musicOn);
      this.audio.vibration = !!settings.vibrationOn;

      const quality = settings.graphicsQuality === 'low'
        ? 0
        : settings.graphicsQuality === 'medium'
          ? 1
          : 2;

      this.renderer.setQuality(quality);
      this.particles.setQuality(quality);
    }

    startEndless() {
      this.currentLevel = null;
      this.currentSeed = Math.floor(Math.random() * 0x7fffffff);
      this.startRun();
    }

    newTrack() {
      this.startEndless();
    }

    startLevel(id) {
      const levelId = Number(id);
      const level = root.LEVELS.find((item) => item.id === levelId);
      if (!level) {
        console.warn('Web Rider: requested level was not found:', id);
        return;
      }

      this.currentLevel = level;
      this.currentSeed = level.seed;
      this.startRun();

      if (this.renderer && level.theme !== undefined) {
        this.renderer.setTheme(level.theme);
      }
    }

    startRun() {
      if (!Number.isFinite(this.currentSeed)) {
        this.currentSeed = Math.floor(Math.random() * 0x7fffffff);
      }

      const firstRun = !!this.storage.get('firstRun');

      // Clear any held touch/key from the title screen or previous run.
      this.input.holding = false;
      this.input.justPressed = false;
      this.input.justReleased = false;

      this.destroyRun();

      try {
        this.physics = new root.PhysicsWorld();
        this.physics.init();

        const level = this.currentLevel;

        // This must be one options object. The former version had an extra
        // opening brace here, which made game.js fail to parse.
        this.track = new root.Track(this.physics, {
          seed: this.currentSeed,
          length: level ? level.length : 0,
          minDifficulty: level ? Math.max(1, level.difficulty - 1) : 1,
          maxDifficulty: level ? level.difficulty : 10,
          pool: RIDER_STYLE_PIECES,
          startFlat: 22
        });

        this.track.initStart();

        const spawnY =
          root.CONFIG.WHEEL_RADIUS -
          root.CONFIG.WHEEL_Y_OFFSET +
          0.05;

        this.vehicle = new root.Vehicle(this.physics, 2, spawnY, this.track);

        const selectedIndex = Number(this.storage.get('activeVehicle')) || 0;
        const selectedVehicle =
          root.CONFIG.VEHICLES[selectedIndex] ||
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
        this.crashEffectsPlayed = false;
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
          const challengeData = Object.assign({}, data, result);

          this.challenges.onLand(challengeData);
          if (result.flips) this.challenges.onFlip(result.flips);

          this.audio.land(result.perfect ? 1.3 : 0.8);
          this.particles.landing(
            data.x,
            data.y,
            this.renderer.theme.edge,
            result.perfect ? 1.5 : 1
          );
        };

        this.vehicle.onLoopComplete = () => {
          this.stunts.onLoop();
          this.challenges.onLoop();
        };

        this.camera.reset(this.runStartX, spawnY);
        this.mode = 'playing';
        this.ui.show('playing');

        // startRun is normally called by a button, which is a user gesture.
        this.audio.unlock();
        this.audio.startEngine();

        if (firstRun) {
          this.ui.showTutorial(4000);
          this.storage.update('firstRun', false);
        }
      } catch (error) {
        console.error('Web Rider could not start a run:', error);
        this.destroyRun();
        this.input.holding = false;
        this.mode = 'menu';

        try {
          this.ui.show('title');
          this.ui.toast('Could not start the run. Check the browser console for details.');
        } catch (uiError) {
          console.error('Web Rider could not restore the menu:', uiError);
        }
      }
    }

    destroyRun() {
      if (this.vehicle) {
        this.vehicle.destroy();
        this.vehicle = null;
      }

      if (this.track) {
        this.track.destroy();
        this.track = null;
      }

      if (this.physics) {
        this.physics.destroy();
        this.physics = null;
      }
    }

    retry() {
      if (this.currentSeed !== null && this.currentSeed !== undefined) {
        this.startRun();
      } else {
        this.startEndless();
      }
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
      this.input.holding = false;
      this.lastTime = 0;

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
      if (this.runEnded || !this.vehicle) return;

      this.runEnded = true;
      this.mode = 'results';
      this.input.holding = false;
      this.audio.stopEngine();

      const distance = Math.max(
        0,
        this.vehicle.getPosition().x - this.runStartX
      );

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

      this.physics.step(
        dt,
        () => {
          if (!this.vehicle || this.mode !== 'playing') return;
          this.vehicle.holding = this.input.holding;
          this.vehicle.beforeStep(root.CONFIG.FIXED_DT);
        },
        (fixedDt) => {
          if (!this.vehicle || this.mode !== 'playing') return;

          this.vehicle.afterStep(fixedDt);
          this.track.update(fixedDt, this.vehicle);

          // A level finish can switch the mode to "results" during track.update.
          if (this.mode !== 'playing') return;

          const position = this.vehicle.getPosition();
          const distance = Math.max(0, position.x - this.runStartX);
          const speed = this.vehicle.getSpeed();

          this.stunts.addDistance(distance);
          this.challenges.onDistance(distance);
          this.challenges.onTime(this.vehicle.age);
          this.challenges.onSpeed(speed);
          this.challenges.onScore(this.stunts.getScore());

          if (this.currentLevel) {
            this.renderer.setTheme(this.currentLevel.theme);
          } else {
            const themeCount = root.THEMES.length;
            const themeIndex =
              Math.floor(distance / root.CONFIG.THEME_LENGTH) % themeCount;
            this.renderer.setTheme(themeIndex);
          }

          if (this.physics.stepCount - this.lastCleanupStep >= 64) {
            this.track.ensureGeneratedAhead(position.x);
            this.track.cleanupBehind(position.x);
            this.lastCleanupStep = this.physics.stepCount;
          }

          if (this.vehicle.crashed && !this.runEnded) {
            this.crashElapsed += fixedDt;

            if (!this.crashEffectsPlayed) {
              this.crashEffectsPlayed = true;
              this.particles.crashBurst(
                position.x,
                position.y,
                ['#ff304f', '#ff9b38', '#fff']
              );
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
      if (
        (this.mode === 'playing' || this.mode === 'results') &&
        this.vehicle &&
        this.track
      ) {
        const position = this.vehicle.getPosition();
        const groundY = this.track.getGroundYAt(position.x, position.y);
        const height = groundY === null
          ? 0
          : Math.max(0, position.y - groundY);
        const speed = this.vehicle.getSpeed();

        this.camera.update(dt, position, speed, height);
        this.particles.update(dt);

        const selectedIndex = Number(this.storage.get('activeVehicle')) || 0;
        const skin =
          root.CONFIG.VEHICLES[selectedIndex] ||
          root.CONFIG.VEHICLES[0];

        const front = this.vehicle.getFrontWheelPos();
        const rear = this.vehicle.getRearWheelPos();

        const state = {
          x: position.x,
          y: position.y,
          a: this.vehicle.getAngle(),
          fx: front.x,
          fy: front.y,
          fa: this.vehicle.getFrontWheelAngle(),
          rx: rear.x,
          ry: rear.y,
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
          speed
        });

        // The audio module already provides this method; keep its engine
        // sound responsive to throttle and current speed.
        if (this.mode === 'playing') {
          this.audio.updateEngine(speed, this.input.holding);

          const distance = Math.max(0, position.x - this.runStartX);
          this.ui.updateHUD({
            score: this.stunts.getScore(),
            gems: this.stunts.gems,
            distance,
            levelLength: this.currentLevel ? this.currentLevel.length : 0,
            levelName: this.currentLevel ? this.currentLevel.name : ''
          });
        }

        return;
      }

      this.renderer.render(dt, { cam: this.camera });
    }

    frame(now) {
      if (this.destroyed) return;

      try {
        const dt = this.lastTime
          ? Math.min(0.05, Math.max(0, (now - this.lastTime) / 1000))
          : 0;

        this.lastTime = now;
        this.updateSimulation(dt);

        if (this.mode === 'playing' || this.mode === 'results') {
          this.stunts.update(dt);
        }

        this.render(dt);
        this.input.clearEdgeEvents();
        this.frameHandle = requestAnimationFrame((time) => this.frame(time));
      } catch (error) {
        this._showFatalError(error);
      }
    }

    _showFatalError(error) {
      console.error('Web Rider stopped after a runtime error:', error);
      this.destroyed = true;
      this.input.holding = false;
      this.audio.stopEngine();

      const panel = document.createElement('div');
      panel.setAttribute('role', 'alert');
      panel.style.cssText = [
        'position:fixed',
        'inset:0',
        'z-index:99999',
        'display:flex',
        'align-items:center',
        'justify-content:center',
        'padding:24px',
        'background:rgba(4,6,18,.96)',
        'color:#fff',
        'font:16px/1.5 system-ui,sans-serif',
        'text-align:center'
      ].join(';');

      const content = document.createElement('div');
      content.style.maxWidth = '640px';

      const heading = document.createElement('h1');
      heading.textContent = 'Web Rider hit an error';
      heading.style.color = '#ff536e';

      const detail = document.createElement('p');
      detail.textContent =
        error && error.message
          ? error.message
          : 'An unexpected error stopped the game.';

      const hint = document.createElement('p');
      hint.textContent =
        'Reload the page to try again. The full error is in the browser console.';

      const reload = document.createElement('button');
      reload.type = 'button';
      reload.textContent = 'Reload';
      reload.style.cssText =
        'padding:12px 20px;border:0;border-radius:10px;background:#ff304f;color:#fff;font:700 16px system-ui,sans-serif;';
      reload.addEventListener('click', () => root.location.reload());

      content.append(heading, detail, hint, reload);
      panel.appendChild(content);
      document.body.appendChild(panel);
    }
  }

  root.Game = Game;

  try {
    root.game = new Game();
  } catch (error) {
    console.error('Web Rider could not initialize:', error);

    const panel = document.createElement('div');
    panel.setAttribute('role', 'alert');
    panel.style.cssText =
      'position:fixed;inset:0;z-index:99999;display:grid;place-items:center;padding:24px;background:#070a18;color:#fff;font:16px/1.5 system-ui,sans-serif;text-align:center';

    const message = document.createElement('p');
    message.textContent =
      'Web Rider could not start: ' +
      (error && error.message ? error.message : 'unknown initialization error');

    panel.appendChild(message);
    document.body.appendChild(panel);
  }
})(window);
