import assert from 'node:assert';
import { POSES, toLandmarks, lerpPose } from '../web/poses.js';
import { pickPerson, standingScore } from '../web/person.js';

function test(name, fn) { fn(); console.log('ok  ' + name); }
const shift = (lm, dx, scale = 1) => lm.map((p) => ({ ...p, x: 0.5 + (p.x - 0.5) * scale + dx, y: 0.88 + (p.y - 0.88) * scale }));
const me = toLandmarks(POSES[0]);

// someone sitting on a chair, seen from the side: knees level with the hips, feet below the knees
function seated(dx = 0, scale = 1) {
  const lm = toLandmarks(POSES[0]).map((p) => ({ ...p }));
  const hipY = 0.62;
  for (const i of [23, 24]) lm[i].y = hipY;
  for (const i of [25, 26]) { lm[i].y = hipY + 0.01; lm[i].x = lm[23].x + 0.13; }
  for (const i of [27, 28, 29, 30, 31, 32]) { lm[i].y = 0.86; lm[i].x = lm[23].x + 0.14; }
  const top = lm[11].y - 0.38;
  for (let i = 0; i <= 22; i++) lm[i].y -= top;                       // the upper body sits on the hips
  return shift(lm, dx, scale);
}

test('no poses', () => assert.equal(pickPerson([], null).lm, null));
test('one pose is taken as is', () => assert.equal(pickPerson([me], null).lm, me));
test('standing scores higher than sitting', () => {
  assert.equal(standingScore(me), 1);
  assert.ok(standingScore(seated()) < 0.5);
});
test('at the start the bigger person is chosen', () => {
  const small = shift(me, 0.3, 0.5);
  assert.equal(pickPerson([small, me], null).lm, me);
});
test('at the start a friend sitting closer to the phone is passed over for the person standing', () => {
  const friend = seated(-0.3, 1.4);
  const user = shift(me, 0.25, 0.8);
  assert.equal(pickPerson([friend, user], null).lm, user);
  assert.equal(pickPerson([user, friend], null).lm, user);
});
test('once counting has started, a bigger passer-by is ignored', () => {
  const first = pickPerson([me], null, 0);
  const passer = shift(me, -0.3, 1.6);
  assert.equal(pickPerson([passer, me], first.centre, 66, true).lm, me);
  assert.equal(pickPerson([me, passer], first.centre, 66, true).lm, me);
});
test('once counting has started, someone elsewhere is not taken when only they are detected', () => {
  const first = pickPerson([me], null, 0);
  const friend = seated(0.35);
  assert.equal(pickPerson([friend], first.centre, 66, true).lm, null);
  assert.equal(pickPerson([friend], first.centre, 1500, true).lm, null);
});
test('follows the person through all 12 poses with a friend sitting nearby', () => {
  let last = pickPerson([me], null, 0).centre;
  const friend = seated(0.35, 1.2);
  let t = 0;
  for (let k = 1; k <= 12; k++) {
    for (let e = 1; e <= 8; e++) {                                   // about half a second per step, 15 frames a second
      const mine = toLandmarks(lerpPose(POSES[k - 1], POSES[k % 12], e / 8));
      t += 66;
      const r = pickPerson([friend, mine], last, t, true);
      assert.equal(r.lm, mine);
      last = r.centre;
    }
  }
});
console.log('all person tests passed');
