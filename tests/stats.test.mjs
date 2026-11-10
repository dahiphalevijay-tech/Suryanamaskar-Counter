import assert from 'node:assert';
import { metForPace, kcalFor, bmi, summarize, dayKey } from '../web/stats.js';

function test(name, fn) { fn(); console.log('ok  ' + name); }
const near = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} not within ${tol} of ${b}`);

test('MET stays within the published range and rises with pace', () => {
  near(metForPace(60), 3.3, 0.01);
  near(metForPace(15), 7.4, 0.01);
  assert.ok(metForPace(30) > metForPace(45));
  assert.equal(metForPace(5), 7.4);
  assert.equal(metForPace(300), 3.3);
});

test('calories: 60 kg for 30 minutes at a brisk pace is near the measured 230 kcal', () => {
  near(kcalFor(60, 30 * 60000, 120), 222, 15);
});

test('calories are zero without weight or activity', () => {
  assert.equal(kcalFor(0, 60000, 3), 0);
  assert.equal(kcalFor(70, 0, 0), 0);
});

test('BMI', () => near(bmi(70, 175), 22.86, 0.01));

test('weekly summary', () => {
  const now = new Date(2026, 10, 10, 21, 0);
  const at = (back, h) => new Date(2026, 10, 10 - back, h, 0);
  const days = { [dayKey(at(0, 6))]: 12, [dayKey(at(2, 6))]: 24, [dayKey(at(8, 6))]: 10 };
  const full = new Array(12).fill(12);
  const partial = full.slice(); partial[7] = 4; partial[3] = 9;
  const sessions = [
    { t: at(0, 6).getTime(), n: 12, ms: 12 * 20000, rounds: 12, rej: 0, steps: partial, kcal: 20 },
    { t: at(2, 6).getTime(), n: 24, ms: 24 * 30000, rounds: 24, rej: 1, steps: new Array(12).fill(24), kcal: 50 },
    { t: at(8, 19).getTime(), n: 10, ms: 10 * 25000, rounds: 10, rej: 0, steps: new Array(12).fill(10), kcal: 18 },
  ];
  const w = summarize(days, sessions, 7, now);
  assert.equal(w.total, 36);
  assert.equal(w.prev, 10);
  assert.equal(w.practised, 2);
  assert.equal(w.best.count, 24);
  assert.equal(w.bars.length, 7);
  assert.equal(w.bars[6].count, 12);
  near(w.paceSec, (12 * 20 + 24 * 30) / 36, 0.01);
  assert.equal(w.kcal, 70);
  assert.equal(w.usualHour, 6);
  assert.deepEqual(w.missed, { step: 8, missed: 8, rounds: 36 });
  const m = summarize(days, sessions, 30, now);
  assert.equal(m.total, 46);
  assert.equal(m.bars.length, 30);
});

test('empty period', () => {
  const e = summarize({}, [], 7, new Date(2026, 10, 10));
  assert.equal(e.total, 0);
  assert.equal(e.best, null);
  assert.equal(e.missed, null);
  assert.equal(e.usualHour, null);
});
console.log('all stats tests passed');
