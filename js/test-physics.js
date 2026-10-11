#!/usr/bin/env node
// test-physics.js — Headless physics test harness for Web Rider.
// Runs the REAL game modules (js/config.js, physics.js, vehicle.js, track-pieces.js, track.js)
// against planck-js from npm. Usage:  node test-physics.js [--seeds=200] [--quick]
'use strict';
global.planck = require('planck-js');
global.window = undefined;
require('./js/config.js');
require('./js/physics.js');
require('./js/vehicle.js');
require('./js/track-pieces.js');
require('./js/track.js');

const { PhysicsWorld, Vehicle, Track, TRACK_PIECES, CONFIG } = globalThis;
const args = Object.fromEntries(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v === undefined ? true : v]; }));
const QUICK = !!args.quick;
const SEEDS = +(args.seeds || (QUICK ? 30 : 200));

let failures = 0;
const results = [];
function report(name, pass, detail) {
  results.push({ name, pass });
  if (!pass) failures++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}
const norm = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const SPAWN_Y = CONFIG.WHEEL_RADIUS - CONFIG.WHEEL_Y_OFFSET + 0.05;

// ─────────────────────────────── bots ───────────────────────────────
const BOTS = {
  'always-hold': () => true,
  'ground-hold': (v) => v.onGround,
  'stabilize': (v, tr) => {
    if (v.onGround) return true;
    const a = norm(v.getAngle() - (tr ? tr.getGroundAngleAt(v.getPosition().x + 3, v.getPosition().y) : 0));
    return a < -0.25 || a > 1.4;
  },
  'flip-then-stabilize': (v, tr) => {
    if (v.onGround) return true;
    if (v.airTime > 0.15 && v.totalRotation < 2 * Math.PI - 1.2 && v.airTime < 0.5) return true;
    const a = norm(v.getAngle() - (tr ? tr.getGroundAngleAt(v.getPosition().x + 3, v.getPosition().y) : 0));
    return a < -0.25 || a > 1.4;
  },
  'random': (v, tr, st) => {
    st.t = (st.t || 0) - 1 / 120;
    if (st.t <= 0) { st.h = st.rng() < 0.7; st.t = 0.1 + st.rng() * 0.6; }
    return st.h;
  },
};

/** Run one simulation. */
function simulate({ track, pw, vehicle, bot, maxTime = 60, maxSteps = Infinity, endX = Infinity, frameDt = 1 / 120, seed = 1, onStep }) {
  const st = { rng: globalThis.mulberry32(seed * 7 + 3) };
  let t = 0, lastProgressX = vehicle.getPosition().x, lastProgressT = 0, maxSpeed = 0, flips = 0, loops = 0, landings = 0;
  let exploded = false, stuck = false;
  vehicle.onLand = (d) => { landings++; flips += Math.floor(Math.abs(d.totalRotation) / (2 * Math.PI) + 0.2); };
  vehicle.onLoopComplete = () => loops++;
  while (t < maxTime) {
    pw.step(frameDt, (d) => { vehicle.holding = bot(vehicle, track, st); vehicle.beforeStep(d); },
      (d) => { vehicle.afterStep(d); if (track) track.update(d, vehicle); });
    t += frameDt;
    const p = vehicle.getPosition();
    if (!isFinite(p.x) || !isFinite(p.y) || vehicle.getSpeed() > 80) { exploded = true; break; }
    maxSpeed = Math.max(maxSpeed, vehicle.getSpeed());
    if (track) { track.ensureGeneratedAhead(p.x); if ((pw.stepCount & 63) === 0) track.cleanupBehind(p.x); }
    if (onStep) onStep(t);
    if (vehicle.crashed || p.x >= endX || pw.stepCount >= maxSteps) break;
    if (p.x > lastProgressX + 2) { lastProgressX = p.x; lastProgressT = t; }
    if (t - lastProgressT > 8) { stuck = true; break; }
  }
  const p = vehicle.getPosition();
  return { dist: p.x, time: t, crashed: vehicle.crashed, reason: vehicle.crashReason, exploded, stuck, maxSpeed, flips, loops, landings, completed: p.x >= endX };
}

function makeWorld() { const pw = new PhysicsWorld(); pw.init(); return pw; }

function flatWorld(len = 2000) {
  const pw = makeWorld();
  const pts = []; for (let x = -10; x <= len; x += 2) pts.push({ x, y: 0 });
  pw.createChain(pts);
  return pw;
}

function pieceTrack(piece, lead = 45) {
  const pw = makeWorld();
  const tr = new Track(pw, { manual: true, startFlat: lead });
  tr.initStart();
  tr.placePiece(piece);
  tr.addFlat(40);
  tr._emit(true);
  const end = tr.placed[0].ex + 15;
  return { pw, tr, end };
}

// ─────────────────────────────── tests ───────────────────────────────
console.log(`Web Rider physics tests — planck-js ${require('planck-js/package.json').version}, dt=${CONFIG.FIXED_DT.toFixed(5)}s, grace=${CONFIG.CRASH_GRACE_MS}ms\n`);

// 1. Flat ground, hold forever
{
  const pw = flatWorld(3000);
  const v = new Vehicle(pw, 0, SPAWN_Y, null);
  let t15 = null;
  const r = simulate({ pw, vehicle: v, bot: BOTS['always-hold'], maxTime: 60, onStep: (t) => { if (t15 === null && v.getSpeed() > 0.9 * 21) t15 = t; } });
  report('Flat ground: hold forever for 60 s', !r.crashed && !r.exploded && r.dist > 200,
    `distance ${r.dist.toFixed(1)} m, top speed ${r.maxSpeed.toFixed(1)} m/s, 90% speed after ${t15 && t15.toFixed(2)} s`);
  report('Flat ground: reaches full speed within 1.5 s', t15 !== null && t15 <= 1.5, `${t15 && t15.toFixed(2)} s`);
}

// 2. Frame-rate independence (30/60/120/144 fps)
{
  const out = [];
  for (const fps of [30, 60, 120, 144]) {
    const pw = flatWorld(1000);
    const tr = new Track(makeWorld(), { manual: true });
    const v = new Vehicle(pw, 0, SPAWN_Y, null);
    const r = simulate({ pw, vehicle: v, bot: BOTS['always-hold'], maxTime: 11, maxSteps: 1200, frameDt: 1 / fps });
    out.push(r.dist);
    void tr;
  }
  const spread = Math.max(...out) - Math.min(...out);
  report('Frame-rate independence (30/60/120/144 fps, 10 s)', spread < 0.5, out.map(d => d.toFixed(2)).join(' / ') + ` m (spread ${spread.toFixed(3)} m)`);
}

// 3. Crash rules
{
  // a) hard upright landing from 6 m must not crash
  let pw = flatWorld(200), v = new Vehicle(pw, 0, 6, null);
  let r = simulate({ pw, vehicle: v, bot: () => false, maxTime: 3 });
  report('Hard upright landing (6 m drop) does not crash', !r.crashed, r.crashed ? r.reason : 'ok');
  // b) chassis/wheel scraping at 50° nose-up on landing must not crash
  pw = flatWorld(200); v = new Vehicle(pw, 0, 2.5, null);
  v.respawn(0, 2.5, 0.85); v.chassis.setLinearVelocity(planck.Vec2(15, 0));
  r = simulate({ pw, vehicle: v, bot: BOTS['ground-hold'], maxTime: 3 });
  report('Wheelie landing at 49° does not crash', !r.crashed, r.crashed ? r.reason : 'ok');
  // c) upside-down landing → head crash
  pw = flatWorld(200); v = new Vehicle(pw, 0, 3, null);
  v.respawn(0, 3, Math.PI);
  v.age = 1;
  r = simulate({ pw, vehicle: v, bot: () => false, maxTime: 3 });
  report('Upside-down landing crashes via HEAD sensor', r.crashed && r.reason === 'head', r.reason);
  // d) grace period: spawned head-down touching the ground → no crash for 600 ms
  pw = flatWorld(200); v = new Vehicle(pw, 0, 1.4, null);
  v.respawn(0, 1.4, Math.PI);
  let crashT = null;
  simulate({ pw, vehicle: v, bot: () => false, maxTime: 2, onStep: (t) => { if (crashT === null && v.crashed) crashT = t; } });
  report('Grace period: no crash in the first 600 ms', crashT === null || crashT >= 0.6, `first crash at ${crashT === null ? 'never' : crashT.toFixed(3) + ' s'}`);
}

// 4. Every piece builds with sane geometry
{
  let bad = [];
  const names = new Set();
  for (const p of TRACK_PIECES) {
    const g = p.build(100, 5);
    const nums = [];
    g.segs.forEach(s => s.pts.forEach(q => nums.push(q.x, q.y)));
    g.gems.forEach(q => nums.push(q.x, q.y));
    if (nums.some(n => !isFinite(n)) || !isFinite(p.length) || p.length <= 0) bad.push(p.id + ':' + p.name);
    names.add(p.name);
  }
  report('All 100 pieces build without NaN/Infinity', TRACK_PIECES.length === 100 && bad.length === 0, bad.join(', ') || `${TRACK_PIECES.length} pieces`);
  report('All 100 pieces have unique names', names.size === TRACK_PIECES.length, `${names.size} unique`);
}

// 5. Per-piece completion by at least one bot
{
  const failed = [];
  const botNames = ['stabilize', 'ground-hold', 'always-hold', 'flip-then-stabilize'];
  const used = {};
  for (const piece of TRACK_PIECES) {
    let ok = false, why = [];
    for (const b of botNames) {
      const { pw, tr, end } = pieceTrack(piece);
      const v = new Vehicle(pw, 2, SPAWN_Y, tr);
      const r = simulate({ track: tr, pw, vehicle: v, bot: BOTS[b], maxTime: 40, endX: end });
      if (r.completed && !r.crashed && !r.exploded) { ok = true; used[b] = (used[b] || 0) + 1; break; }
      why.push(`${b}:${r.exploded ? 'explode' : r.stuck ? 'stuck@' + r.dist.toFixed(0) : r.reason + '@' + r.dist.toFixed(0)}`);
    }
    if (!ok) failed.push(`#${piece.id} ${piece.name} [${why.join(' ')}]`);
  }
  report('Per-piece: all 100 pieces completable by a bot', failed.length === 0, failed.length ? '\n      ' + failed.join('\n      ') : JSON.stringify(used));
}

// 6. Loops: complete at speed, fall out when slow (no instant death)
{
  const loopPieces = TRACK_PIECES.filter(p => p.tags.includes('loop'));
  let okFast = 0, msgs = [];
  for (const piece of loopPieces) {
    const { pw, tr, end } = pieceTrack(piece);
    const v = new Vehicle(pw, 2, SPAWN_Y, tr);
    const r = simulate({ track: tr, pw, vehicle: v, bot: BOTS['stabilize'], maxTime: 40, endX: end });
    const expected = tr.loops.length;
    if (r.loops >= expected && !r.crashed) okFast++; else msgs.push(`${piece.name}: ${r.loops}/${expected} ${r.reason}`);
  }
  report(`Loops: all ${loopPieces.length} loop pieces completed at speed`, okFast === loopPieces.length, msgs.join('; ') || `${okFast}/${loopPieces.length}`);
  // too slow: coast into a r=4.5 loop at ~6 m/s
  const { pw, tr } = pieceTrack(TRACK_PIECES[41], 10);
  const L = tr.loops[0];
  const v = new Vehicle(pw, L.cx - 6, SPAWN_Y, tr);
  for (const b of [v.chassis, v.frontWheel, v.rearWheel]) b.setLinearVelocity(planck.Vec2(6, 0));
  v.age = 1;
  const r = simulate({ track: tr, pw, vehicle: v, bot: () => false, maxTime: 6 });
  report('Loops: too slow → falls back out without completing, no instant death', r.loops === 0 && !(r.crashed && r.time < 1.0), `completed=${r.loops} crashed=${r.crashed}(${r.reason}) t=${r.time.toFixed(2)}s`);
}

// 7. Generated tracks × bots
{
  const botList = QUICK ? ['stabilize', 'always-hold'] : ['always-hold', 'ground-hold', 'stabilize', 'random'];
  const physicsBugs = [];
  for (const b of botList) {
    const dists = [], causes = {};
    const t0 = Date.now();
    for (let s = 1; s <= SEEDS; s++) {
      const pw = makeWorld();
      const tr = new Track(pw, { seed: s * 7919 });
      tr.initStart();
      const v = new Vehicle(pw, 2, SPAWN_Y, tr);
      const r = simulate({ track: tr, pw, vehicle: v, bot: BOTS[b], maxTime: 45, seed: s });
      dists.push(r.dist);
      const c = r.exploded ? 'EXPLOSION' : r.stuck ? 'STUCK' : r.crashed ? r.reason : 'survived';
      causes[c] = (causes[c] || 0) + 1;
      if (r.exploded || r.stuck) physicsBugs.push(`${b} seed ${s * 7919} ${c} @${r.dist.toFixed(0)}m`);
      if (b === 'always-hold' && r.crashed && r.time < 3) physicsBugs.push(`${b} seed ${s * 7919} early crash ${r.reason} @${r.dist.toFixed(0)}m`);
    }
    dists.sort((a, b2) => a - b2);
    const avg = dists.reduce((a, c) => a + c, 0) / dists.length;
    console.log(`      bot ${b.padEnd(20)} ${SEEDS} tracks  avg ${avg.toFixed(0)} m  median ${dists[dists.length >> 1].toFixed(0)} m  max ${dists[dists.length - 1].toFixed(0)} m  causes ${JSON.stringify(causes)}  (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  }
  report(`Generated tracks: no explosions / snags / early false crashes (${SEEDS} seeds × ${botList.length} bots)`, physicsBugs.length === 0, physicsBugs.slice(0, 12).join('; '));
}

// 8. Long-run survival on a fresh track with "hold forever" style: 60 s without false crash at start
{
  const pw = makeWorld();
  const tr = new Track(pw, { seed: 424242, maxDifficulty: 2 });
  tr.initStart();
  const v = new Vehicle(pw, 2, SPAWN_Y, tr);
  const t0 = Date.now();
  const r = simulate({ track: tr, pw, vehicle: v, bot: BOTS['stabilize'], maxTime: 60 });
  const ms = (Date.now() - t0) / (r.time * 120);
  report('Spawn test: 60 s on a fresh easy track without false crash', !r.crashed && !r.exploded && r.dist > 200, `distance ${r.dist.toFixed(0)} m in ${r.time.toFixed(1)} s, ${r.crashed ? r.reason : 'no crash'}; physics ${(ms * 1000).toFixed(0)} µs/step`);
}

console.log(`\n${results.length - failures}/${results.length} tests passed.`);
process.exit(failures ? 1 : 0);
