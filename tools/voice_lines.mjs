// Lists every sentence the app can speak, so tools/make_voices.py can record each one once.
// Usage: node tools/voice_lines.mjs > voice-lines.json
import { STR, MANTRAS } from '../web/i18n.js';
import { POSE_INFO } from '../web/poses.js';
import { spokenLines } from '../web/speech.js';

const lines = [];
const seen = new Set();
function add(lang, text, synthLang, say, pace) {
  const id = `${lang}|${text}`;
  if (seen.has(id)) return;
  seen.add(id);
  lines.push({ lang, text, synthLang, say, pace });
}

const SYNTH = { en: 'en-IN', mr: 'mr-IN', hi: 'hi-IN' };
for (const lang of ['en', 'mr', 'hi']) {
  for (const text of spokenLines(lang, STR, POSE_INFO)) add(lang, text, SYNTH[lang], text, 0.95);
}
// The mantras are chanted in Sanskrit whatever the app language. The ॐ sign confuses the
// voice model, so it is written out as ओम्.
for (const dev of MANTRAS.dev) add('sa', dev, 'hi-IN', dev.replace('ॐ', 'ओम्'), 0.9);

process.stdout.write(JSON.stringify(lines, null, 1));
