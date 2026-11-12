import assert from 'node:assert';
import { POSES, toLandmarks } from '../web/poses.js';
import { pickPerson } from '../web/person.js';

function test(name, fn) { fn(); console.log('ok  ' + name); }
const shift = (lm, dx, scale = 1) => lm.map((p) => ({ ...p, x: 0.5 + (p.x - 0.5) * scale + dx, y: 0.88 + (p.y - 0.88) * scale }));
const me = toLandmarks(POSES[0]);

test('no poses', () => assert.equal(pickPerson([], null).lm, null));
test('one pose is taken as is', () => assert.equal(pickPerson([me], null).lm, me));
test('at the start the bigger person is chosen', () => {
  const small = shift(me, 0.3, 0.5);
  assert.equal(pickPerson([small, me], null).lm, me);
});
test('once following someone, a bigger passer-by is ignored', () => {
  const first = pickPerson([me], null);
  const passer = shift(me, -0.3, 1.6);
  assert.equal(pickPerson([passer, me], first.centre).lm, me);
  assert.equal(pickPerson([me, passer], first.centre).lm, me);
});
test('follows the person as they move through the poses', () => {
  let last = pickPerson([me], null).centre;
  const bystander = shift(me, 0.35);
  for (const pose of POSES) {
    const mine = toLandmarks(pose);
    const r = pickPerson([bystander, mine], last);
    assert.equal(r.lm, mine);
    last = r.centre;
  }
});
console.log('all person tests passed');
