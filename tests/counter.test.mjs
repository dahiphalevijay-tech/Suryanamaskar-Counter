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
    for (let e = 0; e < moveMs; e += DT, t += DT) last = counter.update(toLandmarks(lerpPose(prev, pose, e / moveMs), noise, rnd), t);
    for (let e = 0; e < holdMs; e += DT, t += DT) last = counter.update(toLandmarks(pose, noise, rnd), t);
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
  const { last } = run(c, [...stand, ...reps(12, 250, 100)]);
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
console.log('all counter tests passed');
