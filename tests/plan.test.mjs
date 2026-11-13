import assert from 'node:assert';
import { startPlan, evaluatePlan, todayPlan, splitSets } from '../web/plan.js';
import { mergeProgress, kcalSince } from '../web/stats.js';

function test(name, fn) { fn(); console.log('ok  ' + name); }
const day = (n) => `2026-12-${String(n).padStart(2, '0')}`;

test('a new plan starts at 3 with no history, or at the recent average', () => {
  assert.equal(startPlan(24, {}, day(1)).target, 3);
  assert.equal(startPlan(24, { [day(1)]: 6, [day(2)]: 8, [day(3)]: 10 }, day(4)).target, 8);
  assert.equal(startPlan(12, { [day(1)]: 40 }, day(2)).target, 12);
});

test('the target rises only after it was met on two days, and at most once a day', () => {
  let p = startPlan(24, {}, day(1));
  const days = { [day(1)]: 3 };
  p = evaluatePlan(p, days, day(2)); assert.equal(p.target, 3);
  days[day(2)] = 4;
  p = evaluatePlan(p, days, day(3)); assert.equal(p.target, 4);
  assert.equal(evaluatePlan(p, days, day(3)).target, 4);
  days[day(3)] = 4;
  p = evaluatePlan(p, days, day(4)); assert.equal(p.target, 4);
  days[day(4)] = 2;                       // target missed: no rise
  p = evaluatePlan(p, days, day(5)); assert.equal(p.target, 4);
  days[day(5)] = 5;
  p = evaluatePlan(p, days, day(6)); assert.equal(p.target, 5);
});

test('a steady person reaches the goal and stops there', () => {
  let p = startPlan(12, {}, day(1));
  const days = {};
  for (let d = 1; d <= 28; d++) { p = evaluatePlan(p, days, day(d)); days[day(d)] = p.target; }
  assert.equal(p.target, 12);
});

test('the target eases back after three days without practice', () => {
  let p = { goal: 24, target: 14, since: day(1), lastEval: day(1) };
  p = evaluatePlan(p, { [day(1)]: 14 }, day(5));
  assert.equal(p.target, 12);
  assert.equal(evaluatePlan({ goal: 24, target: 3, since: day(1), lastEval: day(1) }, {}, day(9)).target, 3);
});

test('a lighter day is suggested after six days in a row', () => {
  const days = {};
  for (let d = 1; d <= 6; d++) days[day(d)] = 10;
  const p = { goal: 24, target: 10, since: day(6), lastEval: day(7) };
  assert.deepEqual(todayPlan(p, days, day(7)), { target: 5, rest: true, done: 0, remaining: 5, goal: 24 });
  delete days[day(3)];
  assert.equal(todayPlan(p, days, day(7)).rest, false);
  days[day(7)] = 4;
  assert.equal(todayPlan(p, days, day(7)).remaining, 6);
});

test('restoring progress keeps everything from both sides', () => {
  const cur = { days: { [day(1)]: 5, [day(2)]: 9 }, sessions: [{ t: 10, n: 5 }, { t: 20, n: 9 }] };
  const inc = { app: 'suryanamaskar', days: { [day(1)]: 8, [day(3)]: 4, bad: 3, [day(4)]: 'x' }, sessions: [{ t: 20, n: 9 }, { t: 5, n: 8 }, { junk: 1 }] };
  const m = mergeProgress(cur, inc);
  assert.deepEqual(m.days, { [day(1)]: 8, [day(2)]: 9, [day(3)]: 4 });
  assert.deepEqual(m.sessions.map((s) => s.t), [5, 10, 20]);
  assert.equal(mergeProgress(cur, { days: {} }), null);
  assert.equal(mergeProgress(cur, null), null);
});

test('calories since a day', () => {
  const now = new Date(2026, 11, 10, 9);
  const at = (back) => new Date(2026, 11, 10 - back, 6).getTime();
  const s = [{ t: at(0), kcal: 10 }, { t: at(3), kcal: 20 }, { t: at(10), kcal: 40 }, { t: at(1) }];
  assert.equal(kcalSince(s, 0, now), 10);
  assert.equal(kcalSince(s, 6, now), 30);
  assert.equal(kcalSince(s, 29, now), 70);
});
test('the plan is split evenly into sets', () => {
  assert.deepEqual(splitSets(12, 2), [6, 6]);
  assert.deepEqual(splitSets(12, 5), [3, 3, 2, 2, 2]);
  assert.deepEqual(splitSets(2, 4), [1, 1]);
  assert.deepEqual(splitSets(7, 1), [7]);
});
console.log('all plan tests passed');
