// The exact sentences the app speaks. Shared by the app and by tools/voice_lines.mjs,
// so every sentence spoken during practice has a recorded clip.

const tr = (STR, lang, key) => (STR[lang] && STR[lang][key]) || STR.en[key] || key;
const poseName = (lang, info) => (lang === 'en' ? info.en : info.dev);

// In English a full stop after a one-word name made the voice stretch it ("Plaaank"), so the
// English line is one sentence with a comma; step 9 is said as "Lunge on the other side" (also
// in the short name from round 2), without the comma pause of "Lunge, other leg".
const EN_SAY = { 'Lunge, other leg': 'Lunge on the other side', Cobra: 'Cobra pose' };  // "Cobra" alone came out as "Cobras"
export const poseLine = (STR, lang, info, short = false) => {
  // "Cobra pose" on its own sounded odd, so in English cobra keeps its breathing in every round
  if (short && !(lang === 'en' && info.en === 'Cobra')) return lang === 'en' ? EN_SAY[info.en] || info.en : poseName(lang, info);
  if (lang !== 'en') return `${poseName(lang, info)}. ${tr(STR, lang, info.breath)}`;
  const b = tr(STR, lang, info.breath);
  return `${EN_SAY[info.en] || info.en}, ${b.charAt(0).toLowerCase()}${b.slice(1)}.`;
};
export const missedLine = (STR, lang, info) => `${tr(STR, lang, 'vMissed')}: ${poseName(lang, info)}`;
export const setDoneLine = (STR, lang, k, secs) => tr(STR, lang, 'setDone').replace('{k}', k).replace('{n}', secs);
export const setNextLine = (STR, lang, k) => tr(STR, lang, 'setNext').replace('{k}', k);

export const MAX_COUNT_CLIP = 108;
export const MAX_SETS = 10;
export const REST_CHOICES = [30, 60, 90, 120];
export const PLAIN_KEYS = ['in', 'out', 'hold', 'begin', 'vFar', 'vStand', 'vTurn', 'vLost', 'vNotCounted', 'done', 'rest10', 'dark', 'vFinished', 'sitPranayam', 'ft_plankSag', 'ft_plankHigh', 'ft_cobraHips', 'ft_dogKnees', 'ft_armsBack'];

export function spokenLines(lang, STR, POSE_INFO) {
  const out = [];
  for (const info of POSE_INFO) {
    out.push(poseLine(STR, lang, info), poseLine(STR, lang, info, true), missedLine(STR, lang, info));
  }
  for (const key of PLAIN_KEYS) out.push(tr(STR, lang, key));
  for (let n = 1; n <= MAX_COUNT_CLIP; n++) out.push(String(n));
  for (let k = 1; k <= MAX_SETS; k++) {
    out.push(setNextLine(STR, lang, k));
    for (const s of REST_CHOICES) out.push(setDoneLine(STR, lang, k, s));
  }
  return [...new Set(out)];
}
