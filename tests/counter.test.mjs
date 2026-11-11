import assert from 'node:assert';
import { POSES, lerpPose, toLandmarks } from '../web/poses.js';
import { RepCounter } from '../web/counter.js';

let seed = 7;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const FPS = 15, DT = 1000 / FPS;

// Plays a list of [pose, moveMs, holdMs] through the counter and returns the final count.
function run(counter, script, t0 = 0, noise = 0.012) {
  let t = t0, prev = script[0][0], last;
  for (const [pose, moveMs, holdMs] of script) {
    for (let e = 0; e < moveMs; e += DT, t += DT) last = counter.update(toLandmarks(lerpPose(prev, pose, e / moveMs), noise, rnd), t, 2);
    for (let e = 0; e < holdMs; e += DT, t += DT) last = counter.update(toLandmarks(pose, noise, rnd), t, 2);
    prev = pose;
  }
  return { t, last };
}
const stand = [[POSES[0], 0, 2000]];
const round = (move, hold) => POSES.map((p) => [p, move, hold]);
const reps = (n, move, hold) => Array.from({ length: n }, () => round(move, hold)).flat();

function test(name, fn) { fn(); console.log('ok  ' + name); }

test('calibrates when standing still', () => {
  const c = new RepCounter();
  const { last } = run(c, stand);
  assert.equal(last.calibrated, true);
  assert.equal(last.count, 0);
});

test('counts 5 normal-speed suryanamaskars', () => {
  const c = new RepCounter();
  const { last } = run(c, [...stand, ...reps(5, 600, 400)]);
  assert.equal(last.count, 5);
});

test('counts 12 fast suryanamaskars', () => {
  const c = new RepCounter();
  const { last } = run(c, [...stand, ...reps(12, 350, 150)]);
  assert.equal(last.count, 12);
});

test('counts 3 very slow suryanamaskars', () => {
  const c = new RepCounter();
  const { last } = run(c, [...stand, ...reps(3, 1500, 2500)]);
  assert.equal(last.count, 3);
});

test('does not count forward bends', () => {
  const c = new RepCounter();
  const s = [...stand];
  for (let i = 0; i < 6; i++) s.push([POSES[1], 500, 300], [POSES[2], 600, 500], [POSES[0], 600, 400]);
  assert.equal(run(c, s).last.count, 0);
});

test('does not count squats', () => {
  const c = new RepCounter();
  const up = POSES[0];
  const squat = { ...up, head: [4, -50], sh: [3, -40], el: [14, -38], wr: [24, -40], hip: [-10, -14], knA: [8, -16], knB: [8, -16] };
  const s = [...stand];
  for (let i = 0; i < 8; i++) s.push([squat, 500, 300], [up, 500, 300]);
  assert.equal(run(c, s).last.count, 0);
});

test('does not count a half round that stops at the floor', () => {
  const c = new RepCounter();
  const s = [...stand, ...POSES.slice(0, 7).map((p) => [p, 600, 400]), [POSES[6], 0, 4000]];
  assert.equal(run(c, s).last.count, 0);
});

test('keeps counting after the person is briefly not detected', () => {
  const c = new RepCounter();
  let { t } = run(c, [...stand, ...reps(2, 600, 400)]);
  for (let i = 0; i < 20; i++, t += DT) c.update(null, t);
  const { last } = run(c, reps(2, 600, 400), t);
  assert.equal(last.count, 4);
});

test('asks the person to step back when too close or too small', () => {
  const c = new RepCounter({ minBody: 0.9 });
  assert.equal(run(c, stand).last.stage, 'far');
});

for (const mode of ['easy', 'standard', 'strict']) {
  test(`[${mode}] counts 5 complete suryanamaskars`, () => {
    const c = new RepCounter({ mode });
    assert.equal(run(c, [...stand, ...reps(5, 600, 400)]).last.count, 5);
  });
  test(`[${mode}] does not count squats or forward bends`, () => {
    const c = new RepCounter({ mode });
    const up = POSES[0];
    const squat = { ...up, head: [4, -50], sh: [3, -40], el: [14, -38], wr: [24, -40], hip: [-10, -14], knA: [8, -16], knB: [8, -16] };
    const s = [...stand];
    for (let i = 0; i < 5; i++) s.push([squat, 500, 300], [up, 500, 300], [POSES[1], 400, 300], [POSES[2], 600, 500], [up, 600, 400]);
    assert.equal(run(c, s).last.count, 0);
  });
}

test('follows the steps in order', () => {
  const c = new RepCounter({ mode: 'strict' });
  let { t } = run(c, stand);
  const order = [];
  for (const p of POSES.slice(1)) {
    const r = run(c, [[p, 600, 400]], t); t = r.t;
    order.push(r.last.counted || r.last.step === 1 ? 12 : r.last.step);
  }
  // raised arms on the way up (the 10th entry) is not tracked, so the tracker stays on step 10 through it
  assert.deepEqual(order.slice(0, 10), [2, 3, 4, 5, 6, 7, 8, 9, 10, 10]);
  assert.equal(c.count, 1);
});

// a lazy round: no raised arms, no eight-point, no mountain, second lunge skipped
const lazy = [0, 2, 3, 4, 6, 9, 11].map((i) => [POSES[i], 600, 500]);
test('a round with steps missing: easy counts it, standard and strict do not', () => {
  const counts = {};
  for (const mode of ['easy', 'standard', 'strict']) {
    const c = new RepCounter({ mode });
    counts[mode] = run(c, [...stand, ...lazy, ...lazy, [POSES[0], 0, 1500]]).last.count;
  }
  assert.deepEqual(counts, { easy: 2, standard: 0, strict: 0 });
});

// skips only the eight-point step
const nearly = [0, 1, 2, 3, 4, 6, 7, 8, 9, 10, 11].map((i) => [POSES[i], 600, 400]);
test('a round missing one step: standard counts it, strict does not', () => {
  const counts = {};
  for (const mode of ['standard', 'strict']) {
    const c = new RepCounter({ mode });
    counts[mode] = run(c, [...stand, ...nearly, ...nearly, [POSES[0], 0, 1500]]).last.count;
  }
  assert.deepEqual(counts, { standard: 2, strict: 0 });
});
test('ignores impossible measurements when someone walks up to the camera', () => {
  for (const mode of ['easy', 'standard']) {
    const c = new RepCounter({ mode });
    let { t } = run(c, stand);
    // a close-up: shoulders and hips near the bottom of the picture, then near the top, then standing again
    const blob = (y) => toLandmarks(POSES[0]).map((p) => ({ ...p, y: y + (p.y - 0.5) * 0.1 }));
    for (const y of [0.95, 0.9, 0.1, 0.92, 0.15]) for (let i = 0; i < 12; i++, t += DT) c.update(blob(y), t, 2);
    assert.equal(run(c, stand, t).last.count, 0, mode);
  }
});
test('recalibrates when the person calibrated close to the phone and then stepped back', () => {
  const c = new RepCounter();
  const near = (lm) => lm.map((p) => ({ ...p, x: 0.5 + (p.x - 0.5) * 1.4, y: 0.97 + (p.y - 0.88) * 1.4 }));
  let t = 0;
  for (let i = 0; i < 30; i++, t += DT) c.update(near(toLandmarks(POSES[0], 0.01, rnd)), t, 2);
  assert.equal(c.calibrated, true);
  const bigH = c.H;
  // walks back: a few in-between frames, then stands at the normal spot
  for (let i = 0; i < 12; i++, t += DT) {
    const f = 1.4 - 0.4 * (i / 12);
    c.update(toLandmarks(POSES[0], 0.01, rnd).map((p) => ({ ...p, x: 0.5 + (p.x - 0.5) * f, y: 0.88 + 0.09 * (f - 1) / 0.4 + (p.y - 0.88) * f })), t, 2);
  }
  const r = run(c, [...stand, ...reps(3, 600, 400)], t);
  assert.ok(c.H < bigH * 0.8, 'calibration should have been redone at the new distance');
  assert.equal(r.last.count, 3);
});

test('does not calibrate on someone walking past', () => {
  const c = new RepCounter();
  let t = 0;
  for (let i = 0; i < 45; i++, t += DT) {
    c.update(toLandmarks(POSES[0], 0.01, rnd).map((p) => ({ ...p, x: p.x - 0.3 + i * 0.012 })), t, 2);
  }
  assert.equal(c.calibrated, false);
});

test('a person who starts facing the phone and turns side-on is treated as side view', () => {
  const c = new RepCounter({ mode: 'strict' });
  const facing = (lm) => lm.map((p, i) => (i === 11 ? { ...p, x: p.x - 0.03 } : i === 12 ? { ...p, x: p.x + 0.03 } : p));
  let t = 0;
  for (let i = 0; i < 30; i++, t += DT) c.update(facing(toLandmarks(POSES[0], 0.005, rnd)), t, 2);
  assert.equal(c.front, true);
  const r = run(c, [[POSES[0], 0, 1500], ...reps(2, 600, 400)], t);
  assert.equal(c.front, false);
  assert.equal(r.last.count, 2);
});
test('a round that goes from the forward bend straight to prayer counts even in strict mode', () => {
  const c = new RepCounter({ mode: 'strict' });
  const noEleven = POSES.filter((_, i) => i !== 10).map((p) => [p, 600, 400]);
  assert.equal(run(c, [...stand, ...noEleven, ...noEleven, ...noEleven]).last.count, 3);
});

test('a person facing the camera is asked to turn and nothing is counted', () => {
  for (const mode of ['easy', 'standard', 'strict']) {
    const c = new RepCounter({ mode });
    const facing = (lm) => lm.map((p, i) => (i === 11 ? { ...p, x: p.x - 0.06 } : i === 12 ? { ...p, x: p.x + 0.06 } : p));
    let t = 0, last, prev = POSES[0];
    for (const [pose, moveMs, holdMs] of [...stand, ...reps(3, 600, 400)]) {
      for (let e = 0; e < moveMs + holdMs; e += DT, t += DT) {
        last = c.update(facing(toLandmarks(e < moveMs ? lerpPose(prev, pose, e / moveMs) : pose, 0.01, rnd)), t, 2);
      }
      prev = pose;
    }
    assert.equal(last.count, 0, mode);
    assert.equal(last.stage, 'turn', mode);
  }
});
console.log('all counter tests passed');
