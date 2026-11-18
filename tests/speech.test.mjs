// Every sentence spoken during practice must be in the recorded list, or it falls back to the phone voice.
import assert from 'node:assert/strict';
import { STR, MANTRAS } from '../web/i18n.js';
import { POSE_INFO } from '../web/poses.js';
import { spokenLines, poseLine, missedLine, setDoneLine, setNextLine, PLAIN_KEYS } from '../web/speech.js';
import { clipKey } from '../web/voice.js';

for (const lang of ['en', 'mr', 'hi']) {
  const have = new Set(spokenLines(lang, STR, POSE_INFO));
  for (const info of POSE_INFO) {
    assert.ok(have.has(poseLine(STR, lang, info)));
    assert.ok(have.has(poseLine(STR, lang, info, true)));
    assert.ok(have.has(missedLine(STR, lang, info)));
  }
  for (const k of PLAIN_KEYS) assert.ok(have.has(STR[lang][k] || STR.en[k]), `${lang} ${k}`);
  assert.ok(have.has('108') && have.has('1'));
  assert.ok(have.has(setNextLine(STR, lang, 2)) && have.has(setDoneLine(STR, lang, 1, 60)));
}
assert.equal(MANTRAS.dev.length, 12);
assert.equal(clipKey('sa', 'ॐ मित्राय नमः'), '7b8174d3');  // must match tools/make_voices.py
console.log('speech tests passed');
