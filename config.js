// js/config.js — ALL tunable game constants in one place.
// Works in the browser (window.CONFIG) and in Node (globalThis.CONFIG) for tests.
(function (root) {
  const CONFIG = {
    // ── Physics World ──────────────────────────────────────────
    GRAVITY:            30,     // m/s² (arcade: higher = heavier/snappier, lower = more hang time)
    FIXED_DT:          1 / 120, // physics timestep (s). DO NOT change — use PHYSICS_ITERATIONS instead
    PHYSICS_ITERATIONS: 10,     // velocity + position iterations per step
    MAX_FRAME_DT:      0.05,    // clamp frame delta to avoid spiral of death

    // ── Terrain ────────────────────────────────────────────────
    TERRAIN_FRICTION:   0.9,
    TERRAIN_RESTITUTION: 0.0,
    TERRAIN_CHUNK_VERTS: 48,    // vertices per physics chain fixture
    TERRAIN_CLEANUP_BEHIND: 160,// destroy physics chunks this far behind the bike (m)

    // ── Vehicle body ───────────────────────────────────────────
    CHASSIS_W:         2.0,    // m  chassis width
    CHASSIS_H:         0.55,   // m  chassis height
    CHASSIS_DENSITY:   3.0,    // kg/m²
    CHASSIS_FRICTION:  0.3,
    CHASSIS_RESTITUTION: 0.05,

    WHEEL_RADIUS:      0.42,   // m
    WHEEL_DENSITY:     2.5,
    WHEEL_FRICTION:    2.0,    // HIGH friction so wheels grip terrain
    WHEEL_RESTITUTION: 0.05,

    // Rider/head sensor (the ONLY crash trigger for terrain)
    HEAD_RADIUS:       0.22,   // m
    HEAD_OFFSET_Y:     0.90,   // m above chassis center
    HEAD_OFFSET_X:    -0.20,   // m slightly toward rear

    // ── Motor (ground acceleration) ───────────────────────────
    MOTOR_MAX_TORQUE:  50,     // Nm; increase for faster acceleration
    MOTOR_MAX_SPEED:  -52,     // rad/s (negative = forward on rear wheel) → ~21.8 m/s
    MOTOR_BRAKE_TORQUE: 2,     // small rolling resistance when released
    MAX_SPEED_MS:      30,     // m/s hard cap on chassis speed
    ANTI_WHEELIE:      30,     // Nm corrective torque when only rear wheel touches while holding

    // ── Air rotation ───────────────────────────────────────────
    AIR_TORQUE:        60,     // Nm max torque used to reach AIR_SPIN_SPEED while holding
    AIR_SPIN_SPEED:    9.0,    // rad/s target backflip spin while holding in air
    AIR_RELEASE_DAMP:  4.0,    // 1/s spin decay after releasing in air
    CHASSIS_ANG_DAMPING: 0.8,
    CHASSIS_LIN_DAMPING: 0.05,

    // ── Wheel attachment offsets ──────────────────────────────
    FRONT_WHEEL_X:     0.75,
    REAR_WHEEL_X:     -0.75,
    WHEEL_Y_OFFSET:   -0.28,

    // ── Loops (magnet assist so loops are rideable at arcade speeds) ──
    LOOP_MIN_ENTRY_SPEED: 9,   // m/s needed when entering a loop
    LOOP_STICK_ACCEL:  18,     // m/s² outward stick acceleration inside a loop

    // ── Camera ─────────────────────────────────────────────────
    PHYSICS_SCALE:     32,     // px per meter at 1000px wide reference (auto-scaled to screen)
    REFERENCE_WIDTH:   1000,   // bike ≈ 7% of screen width at any resolution
    CAMERA_BIKE_X:     0.30,   // fraction of screen width where bike sits
    CAMERA_BIKE_Y:     0.55,   // fraction of screen height where bike sits
    CAMERA_LERP_X:     0.12,
    CAMERA_LERP_Y:     0.07,
    CAMERA_LOOKAHEAD:  0.20,
    CAMERA_ZOOM_SPEED: 0.12,
    CAMERA_JUMP_ZOOM:  0.18,

    // ── Crash detection ────────────────────────────────────────
    CRASH_GRACE_MS:    600,    // ms (simulation time) after spawn before crash detection
    PIT_KILL_DEPTH:    7,      // m below a gap lip → crash

    // ── Scoring ────────────────────────────────────────────────
    SCORE_PER_METER:   1,
    SCORE_SINGLE_FLIP: 150,
    SCORE_DOUBLE_FLIP: 400,
    SCORE_TRIPLE_FLIP: 900,
    SCORE_QUAD_FLIP:   2000,
    SCORE_PERFECT_LDG: 200,
    SCORE_NEAR_MISS:   100,
    SCORE_GEM:         50,
    SCORE_LOOP:        250,
    PERFECT_LANDING_DEG: 12,

    // ── Particles ──────────────────────────────────────────────
    TRAIL_MAX:         40,
    SPARK_COUNT:       18,
    CRASH_PARTICLE_COUNT: 60,

    // ── Track generation ───────────────────────────────────────
    TRACK_SEED_DEFAULT: 12345,
    PIECE_WIDTH_SCALE: 1.0,
    MIN_FLAT_BEFORE_HARD: 3,
    DIFFICULTY_RAMP_DIST: 1500,
    GENERATE_AHEAD:    260,

    // ── Theme ──────────────────────────────────────────────────
    ACTIVE_THEME: 0,
    THEME_LENGTH:      600,    // endless mode: theme changes every N meters
    REVIVE_COST: 25,           // gems to continue after a crash
    DAILY_REWARDS: [10, 15, 20, 30, 40, 50, 100], // gems for day 1..7 of a streak

    // ── Garage: vehicles / skins. torque & spin are multipliers on the motor and air spin ──
    VEHICLES: [
      { id: 'crimson',  name: 'Crimson Web',  cost: 0,    body: '#ff1f3d', accent: '#ffffff', trail: '#ff2d55', suit: '#d0102a', suit2: '#1f4cff', torque: 1.00, spin: 1.00 },
      { id: 'cyan',     name: 'Cyan Swing',   cost: 150,  body: '#00e5ff', accent: '#ffffff', trail: '#00e5ff', suit: '#d0102a', suit2: '#1f4cff', torque: 1.03, spin: 1.00 },
      { id: 'gold',     name: 'Gold Rush',    cost: 300,  body: '#ffc93c', accent: '#fff4c2', trail: '#ffb000', suit: '#d0102a', suit2: '#1f4cff', torque: 1.00, spin: 1.06 },
      { id: 'venom',    name: 'Toxic Green',  cost: 500,  body: '#39ff14', accent: '#0b0b0b', trail: '#39ff14', suit: '#151515', suit2: '#39ff14', torque: 1.06, spin: 1.00 },
      { id: 'night',    name: 'Night Black',  cost: 750,  body: '#2b2b3a', accent: '#ffffff', trail: '#b0b8ff', suit: '#111118', suit2: '#ff1f3d', torque: 1.04, spin: 1.04 },
      { id: 'chrome',   name: 'Chrome',       cost: 1000, body: '#d8e2ef', accent: '#7fd1ff', trail: '#e6f4ff', suit: '#d0102a', suit2: '#1f4cff', torque: 1.08, spin: 1.02 },
      { id: 'pink',     name: 'Ghost Pink',   cost: 1400, body: '#ff4fd8', accent: '#ffffff', trail: '#ff7ae8', suit: '#f2f2f2', suit2: '#ff4fd8', torque: 1.05, spin: 1.08 },
      { id: 'cosmic',   name: 'Cosmic Violet',cost: 1900, body: '#9d4dff', accent: '#ffe066', trail: '#b388ff', suit: '#2a0a4a', suit2: '#9d4dff', torque: 1.10, spin: 1.06 },
      { id: 'inferno',  name: 'Inferno',      cost: 2500, body: '#ff6a00', accent: '#ffe600', trail: '#ff3d00', suit: '#1a0a00', suit2: '#ff6a00', torque: 1.12, spin: 1.10 },
    ],
  };

  root.CONFIG = CONFIG;
  if (typeof module !== 'undefined' && module.exports) module.exports = CONFIG;
})(typeof window !== 'undefined' ? window : globalThis);
