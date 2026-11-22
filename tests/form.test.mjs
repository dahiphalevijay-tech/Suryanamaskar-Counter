// Form tips: a tip only after the same mistake in two rounds running, at most one in three rounds.
import assert from 'node:assert/strict';
import { FormCoach, LIMITS } from '../web/form.js';

assert.ok(LIMITS.plankSag({ plank: 0.2 }) && !LIMITS.plankSag({ plank: 0.03 }));
assert.ok(LIMITS.dogKnees({ dog: 120 }) && !LIMITS.dogKnees({ dog: 170 }));
const c = new FormCoach();
const badRound = () => { c.round = { cobraHips: { n: 10, bad: 9 } }; return c.endRound(); };
const goodRound = () => { c.round = { cobraHips: { n: 10, bad: 1 } }; return c.endRound(); };
assert.equal(badRound(), null);          // first time: no tip yet
assert.equal(badRound(), 'cobraHips');   // second round running: tip
assert.equal(badRound(), null);          // not again straight away
assert.equal(goodRound(), null);
assert.equal(c.mostCommon(), 'cobraHips');
console.log('form tests passed');
