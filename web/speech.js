// The exact sentences the app speaks. Shared by the app and by tools/voice_lines.mjs,
// so every sentence spoken during practice has a recorded clip.

const tr = (STR, lang, key) => (STR[lang] && STR[lang][key]) || STR.en[key] || key;
const poseName = (lang, info) => (lang === 'en' ? info.en : info.dev);

// Each pose is announced by its breathing only ("Breathe in"), which is short enough to fit even
// at a quick pace; the pose name is on screen.
export const poseLine = (STR, lang, info) => tr(STR, lang, info.breath);
export const missedLine = (STR, lang, info) => `${tr(STR, lang, 'vMissed')}: ${poseName(lang, info)}`;
export const setDoneLine = (STR, lang, k, secs) => tr(STR, lang, 'setDone').replace('{k}', k).replace('{n}', secs);
export const setNextLine = (STR, lang, k) => tr(STR, lang, 'setNext').replace('{k}', k);

export const MAX_COUNT_CLIP = 108;
export const MAX_SETS = 10;
export const REST_CHOICES = [30, 60, 90, 120];
export const PLAIN_KEYS = ['in', 'out', 'hold', 'begin', 'vFar', 'vStand', 'vTurn', 'vLost', 'vNotCounted', 'done', 'rest10', 'dark', 'vFinished'];

export function spokenLines(lang, STR, POSE_INFO) {
  const out = [];
  for (const info of POSE_INFO) {
    out.push(missedLine(STR, lang, info));
  }
  for (const key of PLAIN_KEYS) out.push(tr(STR, lang, key));
  for (let n = 1; n <= MAX_COUNT_CLIP; n++) out.push(String(n));
  for (let k = 1; k <= MAX_SETS; k++) {
    out.push(setNextLine(STR, lang, k));
    for (const s of REST_CHOICES) out.push(setDoneLine(STR, lang, k, s));
  }
  return [...new Set(out)];
}
