import { POSES, POSE_INFO, lerpPose } from './poses.js';
import { RepCounter, TRACKED_STEPS } from './counter.js';
import { STR, SPEECH_LANG, MANTRAS, NAME_MEANINGS } from './i18n.js';
import { drawShareCard, shareCard } from './share.js';
import { pickPerson } from './person.js';
import { ClipPlayer } from './voice.js';
import { poseLine, missedLine, setDoneLine, setNextLine } from './speech.js';

const sunrisePhoto = new Image(); sunrisePhoto.src = './img/sunrise.jpg';
const guidePhoto = new Image(); guidePhoto.src = './img/guide.jpg';
import { dayKey, kcalFor, bmi, summarize, kcalSince, mergeProgress, healthyWeight } from './stats.js';
import { startPlan, evaluatePlan, todayPlan, splitSets, suggestPlan } from './plan.js';

// Where feedback emails go. The Send feedback button stays hidden until this is filled in.
const FEEDBACK_EMAIL = '';

const $ = (id) => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};

// ---------- language ----------
let lang = store.get('lang', 'en');
const t = (k) => (STR[lang] && STR[lang][k]) || STR.en[k] || k;
function applyLang() {
  document.documentElement.lang = lang;
  document.querySelectorAll('[data-t]').forEach((el) => { el.textContent = t(el.dataset.t); });
  document.querySelectorAll('[data-t-label]').forEach((el) => el.setAttribute('aria-label', t(el.dataset.tLabel)));
  $('settingsBack').setAttribute('aria-label', t('back'));
  renderNames();
  $('play').textContent = t(playing ? 'pause' : 'play');
  showPose(Math.round(animPos) % 12);
  markSuggested();
  document.querySelectorAll('#setRest option').forEach((o) => { o.textContent = `${o.value} ${t('secShort')}`; });
  renderProgress();
  renderProfile();
}

// ---------- progress data ----------
let period = 7;
function addToday(n) {
  if (!n) return;
  const days = store.get('days', {});
  days[dayKey()] = Math.max(0, (days[dayKey()] || 0) + n);
  store.set('days', days);
}
function saveSession(sess) {
  const all = store.get('sessions', []);
  all.push(sess);
  store.set('sessions', all.slice(-3000));
}
const fmtDur = (ms) => { const sec = Math.round(ms / 1000); return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`; };
const fmtHour = (h) => new Date(2000, 0, 1, h).toLocaleTimeString(SPEECH_LANG[lang], { hour: 'numeric' });
const fmtDay = (d) => d.toLocaleDateString(SPEECH_LANG[lang], { day: 'numeric', month: 'short' });
const poseName = (step) => { const info = POSE_INFO[step - 1]; return `${step}. ${lang === 'en' ? info.en : info.dev}`; };

function renderProgress() {
  const days = store.get('days', {});
  const sessions = store.get('sessions', []);
  const today = days[dayKey()] || 0;
  drawHomeSun(days, today);
  $('sToday').textContent = today;
  $('sTotal').textContent = Object.values(days).reduce((a, b) => a + b, 0);
  $('sStreak').textContent = currentStreak();
  renderPlan(days);
  // calories: sessions saved before the weight was entered are worked out from the weight known now
  const w = Number($('weight').value);
  const withKcal = sessions.map((x) => (x.kcal ? x : { ...x, kcal: kcalFor(w, x.ms, x.rounds) }));
  $('kToday').textContent = Math.round(kcalSince(withKcal, 0));
  $('kWeek').textContent = Math.round(kcalSince(withKcal, 6));
  $('kMonth').textContent = Math.round(kcalSince(withKcal, 29));
  $('kAdd').hidden = !!w;

  const sum = summarize(days, sessions, period);
  const bars = $('bars');
  bars.textContent = '';
  const max = Math.max(1, ...sum.bars.map((v) => v.count));
  sum.bars.forEach((v, i) => {
    const col = document.createElement('div');
    const bar = document.createElement('i');
    bar.style.height = `${(v.count / max) * 80}%`;
    bar.title = String(v.count);
    const showLabel = period <= 7 || i % 7 === 1;
    col.append(bar, document.createTextNode(showLabel ? String(v.date.getDate()) : '\u00a0'));
    bars.append(col);
  });

  const box = $('insights');
  box.textContent = '';
  const row = (label, value, cls = '') => {
    const dt = document.createElement('dt'); dt.textContent = label;
    const dd = document.createElement('dd'); dd.textContent = value; if (cls) dd.className = cls;
    box.append(dt, dd);
  };
  const wide = (text) => { const dt = document.createElement('dt'); dt.className = 'wide'; dt.textContent = text; box.append(dt); };
  if (!sum.total) { wide(t('noData')); return; }
  row(t('iTotal'), String(sum.total));
  const diff = sum.total - sum.prev;
  row(t('iVsPrev'), `${diff > 0 ? '+' : ''}${diff}`, diff > 0 ? 'up' : '');
  row(t('iDays'), `${sum.practised} ${t('of')} ${period}`);
  if (sum.best) row(t('iBest'), `${sum.best.count} · ${fmtDay(sum.best.date)}`);
  if (sum.rounds) {
    row(t('iPace'), `${Math.round(sum.paceSec)} ${t('perRound')}`);
    if (sum.usualHour !== null) row(t('iTime'), fmtHour(sum.usualHour));
    row(t('iKcal'), sum.kcal ? `${Math.round(sum.kcal)} ${t('kcal')}` : t('addWeight'));
    row(t('iMissed'), sum.missed ? `${poseName(sum.missed.step)} (${sum.missed.missed} ${t('of')} ${sum.missed.rounds} ${t('rounds')})` : t('iNoMiss'));
  } else wide(t('sinceUpdate'));
}

// The gradual daily plan: shown on the home screen, and used as the target for the next practice.
function planToday(days = store.get('days', {})) {
  let plan = store.get('plan', null);
  if (!plan) return null;
  const next = evaluatePlan(plan, days, dayKey());
  if (next !== plan) { plan = next; store.set('plan', plan); }
  return todayPlan(plan, days, dayKey());
}
function renderPlan(days) {
  const p = planToday(days);
  $('planLine').hidden = !p;
  $('setPlan').hidden = !!p;
  $('planLine').classList.toggle('done', !!(p && !p.remaining));
  $('targetRow').hidden = !!p || Number($('sets').value) > 0;
  const nSets = Number($('sets').value);
  $('setRows').hidden = !nSets;
  // while today's plan still has rounds left, the plan decides how many rounds go in each set
  $('setRoundsRow').hidden = !!(p && p.remaining);
  if (!p) return;
  const head = t(p.rest ? 'planRest' : 'planToday').replace('{n}', p.target);
  const parts = p.remaining ? [head, t('planLeft').replace('{n}', p.remaining)] : [`${t('planDone')} ✓`];
  if (p.remaining && nSets) parts.push(`${t('sets')}: ${splitSets(p.remaining, nSets).join(' + ')}`);
  $('planLine').textContent = parts.join(' · ');
}

function renderLastSummary() {
  const last = store.get('sessions', []).slice(-1)[0];
  const el = $('lastSummary');
  if (!last || !last.n) { el.hidden = true; return; }
  const parts = [`${t('lastSession')}: ${last.n}`];
  if (last.rounds) { parts.push(fmtDur(last.ms)); parts.push(`${Math.round(last.ms / 1000 / last.rounds)} ${t('perRound')}`); }
  if (last.kcal) parts.push(`${t('approx')} ${Math.round(last.kcal)} ${t('kcal')}`);
  el.textContent = parts.join(' · ');
  el.hidden = false;
}

function renderProfile() {
  const b = bmi(Number($('weight').value), Number($('height').value));
  $('bmi').textContent = b ? `${t('bmi')}: ${b.toFixed(1)}` : '';
  const hw = healthyWeight($('height').value);
  $('healthy').textContent = hw ? t('healthy').replace('{a}', hw.low).replace('{b}', hw.high) : '';
  markSuggested();
}

// BMI is used only to suggest a gentler starting goal and pace for the daily plan.
const planSuggestion = () => suggestPlan(bmi(Number($('weight').value), Number($('height').value)));
function markSuggested() {
  const sug = planSuggestion();
  document.querySelectorAll('#planGoal option').forEach((o) => {
    if (Number(o.value)) o.textContent = t('planGoalOpt').replace('{n}', o.value) + (sug && sug.goal === Number(o.value) ? ` (${t('suggested')})` : '');
  });
  $('planSuggest').hidden = !sug;
  if (sug) $('planSuggest').textContent = t(sug.need > 2 ? 'planSuggestSlow' : 'planSuggest').replace('{n}', sug.goal);
}

// ---------- the sunrise on the home and "Well done" screens ----------
// The day's count sits in a sun rising over the horizon. Its 12 rays light up as the day's plan or target is
// reached (without one, a ray for each round, up to 12), and the sun climbs a little as they do.
const SVGNS = 'http://www.w3.org/2000/svg';
function drawSunrise(svg, { count, label, lit, streak }) {
  const el = (tag, attrs, parent = svg) => { const e = document.createElementNS(SVGNS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); parent.append(e); return e; };
  svg.textContent = '';
  const id = svg.id;
  const defs = el('defs', {});
  const sky = el('linearGradient', { id: `${id}Sky`, x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
  el('stop', { offset: '0', 'stop-color': '#B8420C' }, sky);
  el('stop', { offset: '0.55', 'stop-color': '#E8731A' }, sky);
  el('stop', { offset: '1', 'stop-color': '#F7A93B' }, sky);
  const glow = el('radialGradient', { id: `${id}Glow`, cx: 0.5, cy: 0.5, r: 0.5 }, defs);
  el('stop', { offset: '0', 'stop-color': '#FFE9B8', 'stop-opacity': '0.9' }, glow);
  el('stop', { offset: '1', 'stop-color': '#FFE9B8', 'stop-opacity': '0' }, glow);
  el('rect', { width: 300, height: 200, fill: `url(#${id}Sky)` });
  const rise = lit / 12;
  const cy = 202 - 16 * rise;
  el('circle', { cx: 150, cy, r: 132, fill: `url(#${id}Glow)` });
  for (let i = 0; i < 12; i++) {
    const a = Math.PI * (1 - (i + 0.5) / 12);
    const c = Math.cos(a), sn = Math.sin(a);
    el('line', { class: 'ray', x1: 150 + c * 92, y1: cy - sn * 92, x2: 150 + c * 110, y2: cy - sn * 110,
      stroke: i < lit ? '#FFF1CF' : '#A9440F', 'stroke-width': 5, 'stroke-linecap': 'round' });
  }
  el('circle', { cx: 150, cy, r: 84, fill: '#F7A93B' });
  el('circle', { cx: 150, cy, r: 70, fill: '#FBC24E' });
  const n = el('text', { x: 150, y: cy - 40, 'text-anchor': 'middle', 'font-size': String(count) .length > 3 ? 40 : 50, 'font-weight': 800, fill: '#4A1B0C' });
  n.textContent = count;
  const l = el('text', { x: 150, y: cy - 21, 'text-anchor': 'middle', 'font-size': 13, fill: '#4A1B0C' });
  l.textContent = label;
  if (streak > 1) {
    const st = el('text', { x: 284, y: 24, 'text-anchor': 'end', 'font-size': 13, 'font-weight': 600, fill: '#FFE2A8' });
    st.textContent = t('streakDays').replace('{n}', streak);
  }
  el('path', { class: 'curve', d: 'M0 200 Q150 184 300 200 Z' });
  svg.setAttribute('aria-label', `${count} ${label}`);
}
function drawHomeSun(days, today) {
  const p = planToday(days);
  const goal = p ? p.target : Number($('target').value);
  const lit = goal ? Math.min(12, Math.floor((12 * today) / goal)) : Math.min(12, today);
  drawSunrise($('sunrise'), { count: today, label: goal ? t('ofToday').replace('{n}', goal) : t('today'), lit, streak: currentStreak() });
}

// ---------- tabs ----------
document.querySelectorAll('nav button').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('nav button').forEach((x) => x.classList.toggle('active', x === b));
  document.querySelectorAll('.tab').forEach((s) => s.classList.toggle('active', s.id === `tab-${b.dataset.tab}`));
  if (b.dataset.tab === 'progress') renderProgress();
}));

// ---------- learn: animated guide ----------
const anim = $('anim');
const actx = anim.getContext('2d');
let animPos = 0;          // 0..12, fractional part = movement toward the next pose
let playing = true;
let lastFrame = 0;
const MOVE = 0.45;        // share of each step spent moving, the rest is holding the pose

function drawFigure(ctx, j, W, H) {
  const css = getComputedStyle(document.documentElement);
  const body = css.getPropertyValue('--sun').trim() || '#E8731A';
  const back = css.getPropertyValue('--sun2').trim() || '#F5A623';
  const sc = Math.min(W / 110, H / 105);
  const ox = W / 2 + 4 * sc, oy = H - 12 * sc;
  const X = (p) => ox + p[0] * sc, Y = (p) => oy + p[1] * sc;
  ctx.clearRect(0, 0, W, H);
  ctx.strokeStyle = css.getPropertyValue('--line').trim() || '#ddd';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(W * 0.06, oy + 4 * sc); ctx.lineTo(W * 0.94, oy + 4 * sc); ctx.stroke();
  const limb = (pts, w, color) => {
    ctx.strokeStyle = color; ctx.lineWidth = w * sc; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(X(pts[0]), Y(pts[0]));
    for (const p of pts.slice(1)) ctx.lineTo(X(p), Y(p));
    ctx.stroke();
  };
  limb([j.hip, j.knB, j.anB], 5.5, back);
  limb([j.hip, j.sh], 7.5, body);
  limb([j.hip, j.knA, j.anA], 5.5, body);
  limb([j.sh, j.el, j.wr], 4, body);
  ctx.fillStyle = body;
  ctx.beginPath(); ctx.arc(X(j.head), Y(j.head), 6.2 * sc, 0, Math.PI * 2); ctx.fill();
}
function poseAt(pos) {
  const i = Math.floor(pos) % 12, f = pos - Math.floor(pos);
  const prev = POSES[(i + 11) % 12];
  return lerpPose(prev, POSES[i], f / MOVE);
}
function showPose(i) {
  const info = POSE_INFO[i];
  $('stepNo').textContent = i + 1;
  $('poseLocal').textContent = lang === 'en' ? info.en : info.dev;
  $('poseSa').textContent = info.sa;
  $('breath').textContent = t(info.breath);
}
function animLoop(now) {
  const dt = Math.min(100, now - lastFrame); lastFrame = now;
  if (playing && $('tab-learn').classList.contains('active')) {
    animPos = (animPos + (dt / 1600) * Number($('speed').value)) % 12;
  }
  drawFigure(actx, poseAt(animPos), anim.width, anim.height);
  showPose(Math.floor(animPos) % 12);
  requestAnimationFrame(animLoop);
}
$('play').addEventListener('click', () => { playing = !playing; $('play').textContent = t(playing ? 'pause' : 'play'); });
$('prev').addEventListener('click', () => { playing = false; $('play').textContent = t('play'); animPos = ((Math.floor(animPos) + 11) % 12) + 0.99; });
$('next').addEventListener('click', () => { playing = false; $('play').textContent = t('play'); animPos = ((Math.floor(animPos) + 1) % 12) + 0.99; });

// ---------- practice: camera counter ----------
const cam = $('cam');
const view = $('view');
const vctx = view.getContext('2d');
const counter = new RepCounter();
let landmarker = null;
let stream = null;
let running = false;
let sessionCount = 0;
let lastDetect = 0;
let wakeLock = null;
let noticeUntil = 0;
let sess = null;
let mirror = true;
let lastSeenAt = 0;
let lastActiveAt = 0;
let startedAt = 0;
let lastStep = 0;
let followed = null;        // centre of the person being followed
let followedAt = 0;
let sessionTarget = 0;      // rounds aimed for in this practice (0 = none)
let sets = null;            // { n, per, restMs, restUntil, said10 } when practising in sets
let finishAt = 0;
const guide = $('guide');
const gctx = guide.getContext('2d');
const dots = $('dots');
for (const step of TRACKED_STEPS) { const d = document.createElement('span'); d.dataset.step = step; dots.append(d); }
const LINKS = [[11, 13], [13, 15], [12, 14], [14, 16], [11, 12], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28], [27, 31], [28, 32]];

// The person stands side-on, away from the phone, so the voice is the main way the app talks to them.
// Every sentence has a recorded clip in the chosen teacher's voice (Vijay or Ritu); anything without
// a clip, or the "Phone voice" choice, uses the phone's own text-to-speech, slowed down to sound calm.
// parts: a sentence, or a list of pieces said one after another. A piece may be { lang, text, alt }:
// lang 'sa' is a Sanskrit mantra, and alt is how the phone voice should say it in English.
// flush = say it now, dropping anything still queued; otherwise it waits its turn.
const clips = new ClipPlayer();
clips.load();
function phoneSay(text, langTag, flush) {
  try {
    const B = window.AndroidBridge;
    if (B && B.speakQueued) { B.speakQueued(String(text), langTag, flush); return; }
    if (B && B.speak) { B.speak(String(text), langTag); return; }
    if ('speechSynthesis' in window) {
      const u = new SpeechSynthesisUtterance(String(text));
      u.lang = langTag; u.rate = 0.92; u.pitch = 0.95;
      if (flush) speechSynthesis.cancel();
      speechSynthesis.speak(u);
    }
  } catch { /* speech not available */ }
}
function stopPhoneVoice() {
  try {
    const B = window.AndroidBridge;
    if (B && B.speakQueued) B.speakQueued('', SPEECH_LANG[lang], true);
    else if ('speechSynthesis' in window) speechSynthesis.cancel();
  } catch { /* ignore */ }
}
function sayNow(parts, flush = true) {
  const list = (Array.isArray(parts) ? parts : [parts])
    .filter((p) => p !== '' && p != null)
    .map((p) => (typeof p === 'object' ? p : { lang, text: String(p) }));
  if (!list.length) return;
  const who = $('voiceWho').value;
  if (who !== 'phone') {
    const keys = clips.keys(who, list);
    if (keys) {
      if (flush) stopPhoneVoice();
      clips.play(who, keys, flush);
      return;
    }
  }
  if (flush) clips.stop();
  // a mantra on its own with no English spelling (Learn tab) is read by the Hindi voice
  if (list.every((p) => p.lang === 'sa' && !p.alt)) { phoneSay(list.map((p) => p.text).join('. '), 'hi-IN', flush); return; }
  const text = list.map((p) => (p.lang === 'sa' && lang === 'en' ? p.alt : p.text)).join('. ');
  phoneSay(text, SPEECH_LANG[lang], flush);
}
function say(parts, flush = true) {
  if ($('voiceMode').value === 'off') return;
  sayNow(parts, flush);
}
const fullVoice = () => $('voiceMode').value === 'full';
const speakName = (dev) => sayNow([{ lang: 'sa', text: dev }], true);

// ---------- the 12 names of Surya (Learn tab) ----------
function renderNames() {
  const list = $('names');
  list.textContent = '';
  const meanings = NAME_MEANINGS[lang] || NAME_MEANINGS.en;
  MANTRAS.dev.forEach((dev, i) => {
    const li = document.createElement('li');
    const num = document.createElement('span'); num.className = 'n'; num.textContent = i + 1;
    const txt = document.createElement('div'); txt.className = 't';
    const b = document.createElement('b'); b.textContent = dev;
    const sm = document.createElement('small'); sm.textContent = `${MANTRAS.en[i]} · ${meanings[i]}`;
    txt.append(b, sm);
    const play = document.createElement('button');
    play.textContent = '▶'; play.setAttribute('aria-label', MANTRAS.en[i]);
    play.addEventListener('click', () => speakName(dev));
    li.append(num, txt, play);
    list.append(li);
  });
}
// First round: "Lunge. Breathe in", to teach the breathing.
// After the first round only the pose names are spoken (the breathing stays on screen).
const quickPace = () => sess && sess.rounds > 0;
const spokenPose = (step) => poseLine(STR, lang, POSE_INFO[step - 1], quickPace());
// Speaks the round's name and shows it on screen for a few seconds: "Round 3 · ॐ सूर्याय नमः".
let nameTimer = 0;
function chantName(n) {
  const i = ((n % 12) + 12) % 12;
  say([{ lang: 'sa', text: MANTRAS.dev[i], alt: MANTRAS.en[i] }], false);
  const box = $('nameBox');
  box.textContent = `${t('roundN').replace('{n}', n + 1)} · ${MANTRAS.dev[((n % 12) + 12) % 12]}`;
  box.hidden = false;
  clearTimeout(nameTimer);
  nameTimer = setTimeout(() => { box.hidden = true; }, 4000);
}
const STAGE_VOICE = { far: 'vFar', stand: 'vStand', turn: 'vTurn', lost: 'vLost' };
const voiceState = { stage: '', stageAt: 0, target: 0, importantAt: 0, calibSeq: 0 };

function showError(msg) { const e = $('error'); e.textContent = msg; e.hidden = !msg; }

// The "full" pose model keeps hold of a person better in head-down poses; "lite" is faster.
// Start with full and drop to lite if this phone turns out to be too slow for it.
let vision = null;
let visionFiles = null;
let modelKind = '';
let inferMs = 0;
let inferN = 0;
let switching = false;
const SLOW_MS = 85;
const VERY_SLOW_MS = 140;
let smallInput = false;                       // feed the detector a half-size picture (very slow phones)
let onePerson = false;                        // very slow phones look for one person only
const small = document.createElement('canvas');
const sctx = small.getContext('2d');

// ---------- low light ----------
// The picture's brightness is measured twice a second on a tiny copy. In a dim room the picture handed to the
// detector is brightened, which keeps the person found far more often; in a very dark room the person is told.
const DIM = 80, DARK = 30;
const meter = document.createElement('canvas');
meter.width = 32; meter.height = 24;
const mctx = meter.getContext('2d', { willReadFrequently: true });
let light = 128, lightAt = 0, darkSince = 0, darkSaid = false;
function measureLight(now) {
  if (now - lightAt < 500) return;
  lightAt = now;
  try {
    mctx.drawImage(cam, 0, 0, 32, 24);
    const d = mctx.getImageData(0, 0, 32, 24).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    light += (sum / (d.length / 4) - light) * 0.5;
  } catch { /* measuring is optional */ }
  if (light >= DARK) darkSince = 0;
  else if (!darkSince) darkSince = now;
  if (darkSince && now - darkSince > 2500 && !darkSaid) {
    darkSaid = true;
    noticeUntil = now + 5000;
    $('hint').textContent = t('dark');
    say(t('dark'), true);
  }
}
// Phones with little memory or few processor cores start on the light model straight away; so does any
// phone that proved too slow for the full model in an earlier session.
function startingModel() {
  const weak = (navigator.deviceMemory && navigator.deviceMemory <= 2)
    || (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4);
  // The lighter model is less exact, so one slow session is not enough to settle on it: the full model is tried
  // again next time, and only a phone that was too slow twice running stays on the lighter one.
  return weak || Number(store.get('slowPhone', 0)) >= 2 ? 'lite' : 'full';
}

async function loadModel(kind = startingModel()) {
  if (landmarker && modelKind === kind) return;
  if (!vision) {
    vision = await import('./vendor/tasks-vision/vision_bundle.js');
    visionFiles = await vision.FilesetResolver.forVisionTasks('./vendor/tasks-vision/wasm');
  }
  const make = (delegate) => vision.PoseLandmarker.createFromOptions(visionFiles, {
    baseOptions: { modelAssetPath: `./vendor/pose_landmarker_${kind}.task`, delegate },
    // look for more than one person, so friends watching can be told apart from the person practising
    runningMode: 'VIDEO', numPoses: kind === 'full' ? 3 : 2,
    // lower than the defaults so the person is not dropped when the face is hidden (forward bend, mountain)
    minPoseDetectionConfidence: 0.3, minPosePresenceConfidence: 0.3, minTrackingConfidence: 0.3,
  });
  let next;
  try { next = await make('GPU'); } catch { next = await make('CPU'); }
  const old = landmarker;
  landmarker = next;
  modelKind = kind;
  onePerson = false;
  inferMs = 0; inferN = 0;
  if (old) { try { old.close(); } catch { /* ignore */ } }
}

async function start() {
  showError('');
  $('start').disabled = true;
  $('start').textContent = t('loading');
  try {
    await loadModel();
  } catch (e) {
    console.error(e); showError(`${t('modelError')}\n[${e && (e.message || e)}]`); resetStart(); return;
  }
  try {
    stream = await openCamera();
    cam.srcObject = stream;
    await cam.play();
    const facing = stream.getVideoTracks()[0].getSettings().facingMode;
    mirror = facing ? facing === 'user' : (!$('lens').value && $('facing').value === 'user');
    listLenses();
  } catch (e) {
    console.error(e); showError(`${t('camError')}\n[${e && (e.name || '')} ${e && (e.message || e)}]`); resetStart(); return;
  }
  try { if (navigator.wakeLock) wakeLock = await navigator.wakeLock.request('screen'); } catch { /* optional */ }
  counter.o.mode = $('strictness').value;
  counter.reset();
  sessionCount = 0;
  sess = { t: Date.now(), ms: 0, restMs: 0, rounds: 0, rej: 0, steps: new Array(12).fill(0), mantra: $('mantra').checked };
  Object.assign(voiceState, { stage: '', stageAt: 0, target: 0, importantAt: 0, calibSeq: 0 });
  startedAt = lastSeenAt = lastActiveAt = performance.now();
  lastStep = 0;
  followed = null;
  finishAt = 0;
  light = 128; lightAt = 0; darkSince = 0; darkSaid = false;
  const nSets = Number($('sets').value);
  const plan = planToday();
  sets = null;
  if (nSets) {
    // sizes of the sets: shared out from what is left of today's plan, otherwise the chosen rounds per set
    const sizes = plan && plan.remaining ? splitSets(plan.remaining, nSets) : new Array(nSets).fill(Number($('setRounds').value));
    let sum = 0;
    sets = { ends: sizes.map((n) => (sum += n)), restMs: Number($('setRest').value) * 1000, restUntil: 0, said10: false };
  }
  sessionTarget = sets ? sets.ends[sets.ends.length - 1] : plan ? plan.remaining : Number($('target').value);
  $('restBox').hidden = true; $('hint').style.visibility = '';
  $('nameBox').hidden = true;
  showSetLabel();
  $('done').hidden = true;
  $('guidePanel').hidden = true;
  $('count').textContent = '0';
  $('idle').hidden = true; $('live').hidden = false;
  running = true;
  requestAnimationFrame(loop);
}
function resetStart() { $('start').disabled = false; $('start').textContent = t('start'); }

// Opens the chosen lens if one was picked, otherwise the front or back camera.
async function openCamera() {
  const size = { width: { ideal: 640 }, height: { ideal: 480 } };
  const lens = $('lens').value;
  if (lens) {
    try { return await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: lens }, ...size }, audio: false }); } catch (e) { console.error(e); }
  }
  return navigator.mediaDevices.getUserMedia({ video: { facingMode: $('facing').value, ...size }, audio: false });
}

// Lists every camera the phone exposes (names only appear once camera permission has been given).
async function listLenses() {
  try {
    const cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput' && d.deviceId);
    const sel = $('lens');
    const chosen = store.get('lens', '');
    while (sel.options.length > 1) sel.remove(1);
    cams.forEach((c, i) => {
      const o = document.createElement('option');
      o.value = c.deviceId;
      o.textContent = c.label || `${t('camera')} ${i + 1}`;
      sel.append(o);
    });
    sel.value = cams.some((c) => c.deviceId === chosen) ? chosen : '';
  } catch (e) { console.error(e); }
}

function stop(spoken = false) {
  if (!running) return;
  running = false;
  awayAt = 0;
  if (stream) { stream.getTracks().forEach((x) => x.stop()); stream = null; }
  if (wakeLock) { try { wakeLock.release(); } catch { /* ignore */ } wakeLock = null; }
  addToday(sessionCount);
  // a session that stayed on the full model at a good speed clears the slow-phone mark
  if (modelKind === 'full' && inferN > 200) store.set('slowPhone', 0);
  let saved = null;
  if (sess && (sessionCount > 0 || sess.rej > 0)) {
    const kcal = kcalFor(Number($('weight').value), sess.ms, sess.rounds);
    saved = { ...sess, n: sessionCount, kcal: Math.round(kcal * 10) / 10 };
    saveSession(saved);
  }
  sess = null;
  if (spoken && sessionCount > 0) say([t('vFinished'), String(sessionCount)], true);
  renderLastSummary();
  syncReminder();
  $('live').hidden = true;
  resetStart();
  renderProgress();
  if (saved && saved.n > 0) showDone(saved); else $('idle').hidden = false;
}

// ---------- after practice: summary and sharing ----------
let doneSession = null;
function sessionStats(sn) {
  const out = [];
  if (sn.rounds) {
    out.push({ label: t('practiceTime'), value: fmtDur(sn.ms) });
    if (sn.restMs > 1000) out.push({ label: t('rest'), value: fmtDur(sn.restMs) });
    out.push({ label: t('pace'), value: `${Math.round(sn.ms / 1000 / sn.rounds)} ${t('perRound')}` });
  }
  if (sn.kcal) out.push({ label: t('iKcal'), value: `${Math.round(sn.kcal)} ${t('kcal')}` });
  return out;
}
function currentStreak() {
  const days = store.get('days', {});
  let streak = 0;
  const d = new Date();
  if (!days[dayKey(d)]) d.setDate(d.getDate() - 1);
  while (days[dayKey(d)] > 0) { streak += 1; d.setDate(d.getDate() - 1); }
  return streak;
}
function showDone(sn) {
  doneSession = sn;
  drawSunrise($('doneSun'), { count: sn.n, label: t('iTotal'), lit: 12, streak: currentStreak() });
  const box = $('doneStats');
  box.textContent = '';
  const rows = sessionStats(sn);
  rows.push({ label: t('streakLabel'), value: String(currentStreak()) });
  if (sn.rounds) {
    let worst = null;
    for (const step of TRACKED_STEPS) {
      const missed = sn.rounds - sn.steps[step - 1];
      if (step !== 1 && step !== 12 && missed > 0 && (!worst || missed > worst.missed)) worst = { step, missed };
    }
    rows.push({ label: t('iMissed'), value: worst ? `${poseName(worst.step)} (${worst.missed})` : t('iNoMiss') });
  }
  if (sn.mantra && sn.n > 0) rows.push({ label: t('namesDone'), value: sn.n >= 12 ? t('allNames') : t('namesRange').replace('{a}', 1).replace('{b}', sn.n) });
  for (const r of rows) {
    const dt = document.createElement('dt'); dt.textContent = r.label;
    const dd = document.createElement('dd'); dd.textContent = r.value;
    box.append(dt, dd);
  }
  $('idle').hidden = true;
  $('done').hidden = false;
}
function buildShareCard(sn) {
  const card = $('shareCard');
  const stats = [];
  if (sn.rounds) {
    stats.push({ label: t('duration'), value: fmtDur(sn.ms) });
    stats.push({ label: t('paceLabel'), value: `${Math.round(sn.ms / 1000 / sn.rounds)} ${t('secShort')}` });
  }
  if (sn.kcal) stats.push({ label: t('iKcal'), value: `${Math.round(sn.kcal)} kcal` });
  const streak = currentStreak();
  drawShareCard(card, {
    app: t('appName'), count: sn.n, label: t('iTotal'),
    date: new Date(sn.t).toLocaleDateString(SPEECH_LANG[lang], { day: 'numeric', month: 'long', year: 'numeric' }),
    stats, streakText: streak > 1 ? t('streakDays').replace('{n}', streak) : '',
  }, sunrisePhoto);
  return card;
}
$('shareBtn').addEventListener('click', () => {
  if (!doneSession) return;
  shareCard(buildShareCard(doneSession), t('shareText').replace('{n}', doneSession.n));
});
$('doneClose').addEventListener('click', () => { $('done').hidden = true; $('idle').hidden = false; });

const setsDone = () => Math.min(sets.ends.length - 1, sets.ends.filter((e) => e <= sessionCount).length);
function showSetLabel() {
  $('setLabel').hidden = !sets;
  if (sets) $('setLabel').textContent = t('setOf').replace('{k}', setsDone() + 1).replace('{n}', sets.ends.length);
}
// Rest between sets: the camera stays on, nothing is counted, and the practice does not finish by itself.
// Pranayama in the rest, after Patanjali: breathe in (puraka) 4 s, hold (kumbhaka) 4 s, breathe out
// (rechaka) 6 s. "Gentle" leaves out the hold. A new breath only starts if it ends before the
// ten-second call; until then, and after, the person just sits.
const BREATH = { guided: [['in', 4000], ['hold', 4000], ['out', 6000]], gentle: [['in', 4000], ['out', 6000]] };
function breatheFrame(now) {
  const plan = BREATH[sets.style];
  if (!plan || now < sets.breathFrom) return;
  const cycle = plan.reduce((a, p) => a + p[1], 0);
  const n = Math.floor((now - sets.breathFrom) / cycle);
  const cycleStart = sets.breathFrom + n * cycle;
  if (sets.restUntil - cycleStart < cycle + 11000) {
    // no room for another full breath: settle and wait for the call
    $('restCircle').style.transform = 'scale(0.62)';
    if (sets.phase !== 'end') { sets.phase = 'end'; $('restBreath').textContent = t('restSit'); }
    return;
  }
  let at = now - cycleStart, phase = plan[0][0], into = 0, len = plan[0][1];
  for (const [name, ms] of plan) { if (at < ms) { phase = name; into = at; len = ms; break; } at -= ms; }
  const x = into / len, ease = x * x * (3 - 2 * x);
  const size = phase === 'in' ? ease : phase === 'hold' ? 1 : 1 - ease;
  $('restCircle').style.transform = `scale(${(0.62 + 0.38 * size).toFixed(3)})`;
  const key = `${n}:${phase}`;
  if (key !== sets.phase) {
    sets.phase = key;
    $('restBreath').textContent = t(phase);
    say(t(phase), true);
  }
}
function restFrame(now, W, H) {
  vctx.save();
  if (mirror) { vctx.translate(W, 0); vctx.scale(-1, 1); }
  vctx.drawImage(cam, 0, 0, W, H);
  vctx.restore();
  restTick(now);
}
// The rest timer and its voice. Runs from the camera loop, and from a plain timer when the app is
// in the background, so the rest keeps going and the voice still calls the next set.
function restTick(now) {
  lastSeenAt = lastActiveAt = now;
  const left = sets.restUntil - now;
  if (left > 0) {
    $('restTime').textContent = Math.ceil(left / 1000);
    breatheFrame(now);
    if (!sets.said10 && left <= 10500 && sets.restMs > 15000) { sets.said10 = true; say(t('rest10'), true); }
    return;
  }
  if (sess) sess.restMs += Math.max(0, now - sets.restStart);
  sets.restUntil = 0; sets.said10 = false; sets.phase = '';
  $('restBox').hidden = true; $('hint').style.visibility = '';
  counter.recalibrate();                  // "Begin" is spoken once the person is standing still again
  Object.assign(voiceState, { stage: 'stand', stageAt: now, target: 0 });
  say(setNextLine(STR, lang, setsDone() + 1), true);
  showSetLabel();
}
$('restBox').addEventListener('click', () => { if (sets && sets.restUntil) sets.restUntil = performance.now(); });

function setCount(n) {
  sessionCount = Math.max(0, n);
  counter.count = sessionCount;
  $('count').textContent = sessionCount;
}

function loop(now) {
  if (!running) return;
  requestAnimationFrame(loop);
  if (cam.readyState < 2 || now - lastDetect < 66) return;
  lastDetect = now;
  const W = cam.videoWidth, H = cam.videoHeight;
  if (!W || !H) return;
  if (view.width !== W) { view.width = W; view.height = H; }
  if (finishAt && now > finishAt) { stop(true); return; }
  if (sets && sets.restUntil) { restFrame(now, W, H); return; }
  let lm = null;
  try {
    const t0 = performance.now();
    measureLight(now);
    let input = cam;
    const gain = light < DIM ? Math.min(3, 110 / Math.max(light, 15)) : 1;
    if (smallInput || gain > 1) {
      const w = smallInput ? W >> 1 : W, h = smallInput ? H >> 1 : H;
      if (small.width !== w || small.height !== h) { small.width = w; small.height = h; }
      sctx.filter = gain > 1 ? `brightness(${gain.toFixed(2)})` : 'none';
      sctx.drawImage(cam, 0, 0, w, h);
      input = small;
    }
    const res = landmarker.detectForVideo(input, now);
    // before counting starts: the person standing in full view; after: stay with that person
    const pick = pickPerson(res.landmarks, followed, now, counter.calibrated);
    lm = pick.lm;
    followed = pick.centre;
    if (lm) followedAt = now;
    // out of view for a while: look for them afresh, but keep remembering where the others are
    else if (followed && Number.isFinite(followed.x) && now - followedAt > (counter.calibrated ? 8000 : 3000)) followed = { others: followed.others || [] };
    const dt = performance.now() - t0;
    inferN += 1;
    if (inferN > 5) inferMs += (dt - inferMs) / Math.min(inferN - 5, 30);
    if (modelKind === 'full' && inferN > 45 && inferMs > SLOW_MS && !switching) {
      switching = true;
      store.set('slowPhone', Number(store.get('slowPhone', 0)) + 1);
      loadModel('lite').catch((e) => console.error(e)).finally(() => { switching = false; });
    }
    if (modelKind === 'lite' && inferN > 30 && inferMs > VERY_SLOW_MS) {
      // first look for one person only, then shrink the picture
      if (!onePerson) { onePerson = true; landmarker.setOptions({ numPoses: 1 }).catch((e) => console.error(e)); inferN = 6; }
      else if (!smallInput) { smallInput = true; inferN = 6; }
    }
  } catch (e) { console.error(e); }
  const out = counter.update(lm || null, now, W / H);

  vctx.save();
  if (mirror) { vctx.translate(W, 0); vctx.scale(-1, 1); }
  vctx.drawImage(cam, 0, 0, W, H);
  if (lm) {
    vctx.strokeStyle = '#F5A623'; vctx.lineWidth = Math.max(3, W / 160); vctx.lineCap = 'round';
    for (const [a, b] of LINKS) {
      if (lm[a].visibility < 0.5 || lm[b].visibility < 0.5) continue;
      vctx.beginPath(); vctx.moveTo(lm[a].x * W, lm[a].y * H); vctx.lineTo(lm[b].x * W, lm[b].y * H); vctx.stroke();
    }
  }
  vctx.restore();
  if (!out.calibrated) {
    // a dashed frame showing where the whole body should fit before counting starts
    vctx.save();
    vctx.strokeStyle = 'rgba(255,255,255,.85)'; vctx.lineWidth = Math.max(2, W / 240); vctx.setLineDash([W / 40, W / 40]);
    vctx.strokeRect(W * 0.08, H * 0.05, W * 0.84, H * 0.8);
    vctx.restore();
  }

  // step guide below the picture: the figure and name of the next step; the dots show the steps recognised
  if (out.calibrated && out.visible && out.stage !== 'turn' && !finishAt) {
    const target = out.next;
    const info = POSE_INFO[target - 1];
    const name = lang === 'en' ? info.en : info.dev;
    const phase = (now % 1700) / 1700;
    drawFigure(gctx, lerpPose(POSES[out.step - 1], POSES[target - 1], phase / 0.55), guide.width, guide.height);
    $('guidePanel').hidden = false;
    $('guideStep').textContent = `${target} / 12`;
    $('guideName').textContent = name;
    $('guideBreath').textContent = t(info.breath);
    const dir = (mirror ? -1 : 1) * (out.facing || 1);
    guide.style.transform = dir < 0 ? 'scaleX(-1)' : '';
    if (now > noticeUntil) $('hint').textContent = `${target}. ${name} · ${t(info.breath)}`;
    [...dots.children].forEach((d) => { const n = Number(d.dataset.step); d.className = out.seen[n] ? 'on' : (n === target ? 'next' : ''); });
  } else {
    $('guidePanel').hidden = true;
    // only setup messages are shown here; while the person is walking to or from the phone the last one stays
    const setup = ['far', 'stand', 'calibrating', 'turn', 'lost'].includes(out.stage);
    if (setup && (now > noticeUntil || out.stage === 'turn')) $('hint').textContent = t(out.stage);
    else if (!out.calibrated && now > noticeUntil) $('hint').textContent = t('stand');
    if (out.stage === 'turn') [...dots.children].forEach((d) => { d.className = ''; });
  }
  if (out.rejected) {
    if (sess) sess.rej += 1;
    noticeUntil = now + 2500;
    $('hint').textContent = t('notCounted');
    say(t('vNotCounted'), true); voiceState.importantAt = now; voiceState.afterImportant = true;
    if (navigator.vibrate) navigator.vibrate([40, 60, 40]);
  }

  // ----- voice guidance -----
  const tracking = out.calibrated && out.visible && out.stage !== 'turn';
  if (out.calibSeq !== voiceState.calibSeq && out.calibrated) {
    voiceState.calibSeq = out.calibSeq;
    voiceState.stage = 'ok'; voiceState.target = 0;
    say(t('begin'), true); voiceState.importantAt = now; voiceState.afterImportant = true;
    if ($('mantra').checked) chantName(sessionCount);
  }
  if (!tracking) {
    const key = STAGE_VOICE[out.stage];
    const every = out.stage === 'lost' ? 20000 : 8000;
    const settled = out.stage !== 'lost' || now - lastSeenAt > 4000;
    if (key && settled && (voiceState.stage !== out.stage || now - voiceState.stageAt > every)) {
      voiceState.stage = out.stage; voiceState.stageAt = now; voiceState.target = 0;
      say(t(key), true);
    }
  } else {
    voiceState.stage = 'ok';
    if (fullVoice() && !finishAt && out.next !== voiceState.target && !out.counted) {
      voiceState.target = out.next;
      // let a count, "Begin" or mantra that was just spoken finish before naming the next pose;
      // after that, each new pose name replaces the previous one so the voice never falls behind
      const wait = voiceState.afterImportant && now - voiceState.importantAt < 4000;
      voiceState.afterImportant = false;
      say(spokenPose(out.next), !wait);
    }
  }

  // ----- hands-free finish -----
  if (out.visible) lastSeenAt = now;
  if (out.step !== lastStep || out.counted) { lastStep = out.step; lastActiveAt = now; }
  if ($('autoFinish').checked && sessionCount > 0 && (now - lastSeenAt > 10000 || now - lastActiveAt > 45000)) { stop(true); return; }
  if (sessionCount === 0 && now - Math.max(lastSeenAt, startedAt) > 300000) { stop(false); return; }
  if ($('optNumbers').checked) {
    const f = out.feat;
    $('tuneBox').hidden = false;
    $('tuneBox').textContent = `${modelKind}${smallInput ? ' small' : ''} ${inferMs.toFixed(0)}ms\nstep ${out.step} ${out.front ? 'front' : 'side'}\nh ${f.h.toFixed(2)}  k ${f.k.toFixed(2)}\nraise ${f.raise.toFixed(2)}\nfeet ${f.sep.toFixed(2)}\nreach ${f.reach.toFixed(2)}`;
  } else $('tuneBox').hidden = true;

  if (out.counted) {
    if (sess && out.round) {
      sess.ms += out.round.ms;
      sess.rounds += 1;
      for (let i = 1; i <= 12; i++) if (out.round.seen[i]) sess.steps[i - 1] += 1;
    }
    sessionCount = out.count;
    $('count').textContent = sessionCount;
    say(String(sessionCount), true); voiceState.importantAt = now; voiceState.afterImportant = true; voiceState.target = 0;
    if (fullVoice() && out.round) {
      const missed = TRACKED_STEPS.find((step) => !out.round.seen[step]);
      if (missed) say(missedLine(STR, lang, POSE_INFO[missed - 1]), false);
    }
    if (navigator.vibrate) navigator.vibrate(60);
    if (sets && sets.ends.includes(sessionCount)) {
      const k = sets.ends.indexOf(sessionCount) + 1;
      if (k >= sets.ends.length) {
        // last set: no next step is announced; the count is heard, then the practice finishes
        finishAt = now + 1800;
        noticeUntil = now + 4000; $('hint').textContent = t('done');
        $('guidePanel').hidden = true;
      }
      else {
        sets.restUntil = now + sets.restMs; sets.restStart = now; sets.phase = '';
        $('restNext').textContent = t('restNext').replace('{k}', k + 1).replace('{n}', sets.ends.length)
          .replace('{r}', sets.ends[k] - sets.ends[k - 1]);
        say(setDoneLine(STR, lang, k, sets.restMs / 1000), false);
        // pranayama: first the "sit down" instruction, then breathing begins once that has been said
        sets.style = sets.restMs >= 45000 ? $('restStyle').value : 'free';
        if (sets.style !== 'free') say(t('sitPranayam'), false);
        sets.breathFrom = now + 10000;
        $('restCircle').parentElement.style.visibility = sets.style === 'free' ? 'hidden' : '';
        $('restBreath').textContent = t(sets.style === 'free' ? 'restFree' : 'restSit');
        $('restTime').textContent = sets.restMs / 1000;
        $('restBox').hidden = false; $('guidePanel').hidden = true; $('hint').style.visibility = 'hidden';
      }
    } else if (sessionTarget && sessionCount === sessionTarget) { noticeUntil = now + 4000; $('hint').textContent = t('done'); say(t('done'), false); }
    else if ($('mantra').checked) chantName(sessionCount);
  }
}

$('start').addEventListener('click', start);
$('stop').addEventListener('click', () => stop(false));
$('plus').addEventListener('click', () => setCount(sessionCount + 1));
$('minus').addEventListener('click', () => setCount(sessionCount - 1));
// Leaving the app (home button, a call) pauses practice instead of ending it: the camera is let go,
// a rest keeps counting down with its voice, and coming back carries on. Away for over ten
// minutes ends the session as usual.
let awayAt = 0;
setInterval(() => { if (running && awayAt && sets && sets.restUntil) restTick(performance.now()); }, 500);
async function comeBack() {
  const now = performance.now();
  const away = now - awayAt;
  awayAt = 0;
  if (away > 600000) { stop(false); return; }
  try {
    stream = await openCamera();
    cam.srcObject = stream;
    await cam.play();
  } catch (e) { console.error(e); stop(false); return; }
  try { if (navigator.wakeLock) wakeLock = await navigator.wakeLock.request('screen'); } catch { /* optional */ }
  lastSeenAt = lastActiveAt = performance.now();
  if (!(sets && sets.restUntil)) {
    // a round broken by the pause starts again from standing still
    counter.recalibrate();
    Object.assign(voiceState, { stage: 'stand', stageAt: lastSeenAt, target: 0 });
  }
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden && running && !awayAt) {
    awayAt = performance.now();
    if (stream) { stream.getTracks().forEach((x) => x.stop()); stream = null; }
    if (wakeLock) { try { wakeLock.release(); } catch { /* ignore */ } wakeLock = null; }
  }
  if (!document.hidden && running && awayAt) comeBack();
  if (!document.hidden) refreshScreens();
});

// Keeps "today", the streak and the insights current when the app is reopened or the date changes,
// without the user having to switch tabs or restart the app.
let shownDay = dayKey();
function refreshScreens() {
  shownDay = dayKey();
  if (running) return;
  renderProgress();
  renderLastSummary();
}
window.addEventListener('focus', refreshScreens);
window.addEventListener('pageshow', refreshScreens);
setInterval(() => { if (dayKey() !== shownDay) refreshScreens(); }, 30000);

// ---------- settings ----------
$('lang').value = lang;
$('lang').addEventListener('change', () => { lang = $('lang').value; store.set('lang', lang); applyLang(); syncReminder(); });
for (const [id, def] of [['optNumbers', false], ['mantra', false], ['autoFinish', true]]) {
  $(id).checked = store.get(id, def);
  $(id).addEventListener('change', () => store.set(id, $(id).checked));
}
for (const id of ['facing', 'target', 'strictness', 'weight', 'height', 'theme', 'voiceMode', 'voiceWho', 'restStyle', 'sets', 'setRounds', 'setRest']) {
  $(id).value = store.get(id, $(id).value);
  $(id).addEventListener('change', () => store.set(id, $(id).value));
}
$('lens').addEventListener('change', () => store.set('lens', $('lens').value));
$('voiceWho').addEventListener('change', () => sayNow(t('begin'), true));
$('sets').addEventListener('change', () => renderPlan());
$('weight').addEventListener('change', renderProgress);
$('kAdd').addEventListener('click', () => openSettings('weight'));

// ---------- settings page (gear icon) ----------
// The phone's back button closes it instead of leaving the app.
function setBackWanted(on) { try { if (window.AndroidBridge && window.AndroidBridge.setBackWanted) window.AndroidBridge.setBackWanted(on); } catch { /* not in the app */ } }
function openSettings(focusId) {
  if (running) return;
  $('settings').hidden = false;
  $('settings').scrollTop = 0;
  setBackWanted(true);
  if (focusId) setTimeout(() => { $(focusId).scrollIntoView({ block: 'center' }); if (focusId === 'weight') $(focusId).focus(); }, 50);
}
function closeSettings() {
  $('settings').hidden = true;
  setBackWanted(false);
  disarmClear();
  renderProgress(); renderLastSummary();
}
window.onBack = () => { if (!$('settings').hidden) { closeSettings(); return true; } return false; };
$('gear').addEventListener('click', () => openSettings());
$('settingsBack').addEventListener('click', closeSettings);
$('planLine').addEventListener('click', () => openSettings('planRow'));
$('setPlan').addEventListener('click', () => openSettings('planRow'));

// ---------- clear all progress (tap twice) ----------
let clearArmed = 0;
function disarmClear() { clearArmed = 0; $('clearBtn').classList.remove('armed'); $('clearBtn').textContent = t('clearBtn'); }
$('clearBtn').addEventListener('click', () => {
  if (!clearArmed || Date.now() - clearArmed > 5000) {
    clearArmed = Date.now();
    $('clearBtn').classList.add('armed');
    $('clearBtn').textContent = t('clearConfirm');
    setTimeout(() => { if (clearArmed && Date.now() - clearArmed >= 5000) disarmClear(); }, 5100);
    return;
  }
  for (const k of ['days', 'sessions', 'plan']) localStorage.removeItem(k);
  $('planGoal').value = '0';
  disarmClear();
  renderProgress(); renderLastSummary(); syncReminder();
  fileMsg(t('cleared'));
});

// ---------- gradual daily plan ----------
$('planGoal').value = String((store.get('plan', null) || {}).goal || 0);
$('planGoal').addEventListener('change', () => {
  const goal = Number($('planGoal').value);
  const sug = planSuggestion();
  store.set('plan', goal ? startPlan(goal, store.get('days', {}), dayKey(), sug ? sug.need : 2) : null);
  syncReminder();
  renderProgress();
});

// ---------- save and restore progress (a file the user keeps; nothing is sent anywhere) ----------
let msgTimer = 0;
function fileMsg(text) {
  $('fileMsg').textContent = text; $('fileMsg').hidden = false;
  clearTimeout(msgTimer); msgTimer = setTimeout(() => { $('fileMsg').hidden = true; }, 6000);
}
window.onFileSaved = (ok) => fileMsg(t(ok ? 'saved' : 'saveFail'));
$('saveBtn').addEventListener('click', () => {
  const data = {
    app: 'suryanamaskar', v: 1, saved: new Date().toISOString(),
    days: store.get('days', {}), sessions: store.get('sessions', []), plan: store.get('plan', null),
    settings: { weight: $('weight').value, height: $('height').value, lang },
  };
  const name = `suryanamaskar-progress-${dayKey()}.json`;
  const text = JSON.stringify(data);
  try {
    if (window.AndroidBridge && window.AndroidBridge.saveFile) { window.AndroidBridge.saveFile(name, text); return; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    fileMsg(t('saved'));
  } catch (e) { console.error(e); fileMsg(t('saveFail')); }
});
$('restoreBtn').addEventListener('click', () => { $('restoreFile').value = ''; $('restoreFile').click(); });
$('restoreFile').addEventListener('change', async () => {
  const file = $('restoreFile').files[0];
  if (!file) return;
  let data = null;
  try { data = JSON.parse(await file.text()); } catch { /* not a progress file */ }
  const merged = mergeProgress({ days: store.get('days', {}), sessions: store.get('sessions', []) }, data);
  if (!merged) { fileMsg(t('badFile')); return; }
  store.set('days', merged.days);
  store.set('sessions', merged.sessions);
  const set = (data.settings && typeof data.settings === 'object') ? data.settings : {};
  for (const [id, lo, hi] of [['weight', 20, 250], ['height', 90, 230]]) {
    const v = Number(set[id]);
    if (!$(id).value && v >= lo && v <= hi) { $(id).value = v; store.set(id, String(v)); }
  }
  const p = data.plan;
  if (!store.get('plan', null) && p && [12, 24, 54, 108].includes(p.goal) && Number.isFinite(p.target) && p.target >= 3 && p.target <= p.goal
    && /^\d{4}-\d{2}-\d{2}$/.test(p.since) && /^\d{4}-\d{2}-\d{2}$/.test(p.lastEval)) {
    store.set('plan', { goal: p.goal, target: Math.floor(p.target), since: p.since, lastEval: p.lastEval });
    $('planGoal').value = String(p.goal);
  }
  renderProgress(); renderProfile(); renderLastSummary(); syncReminder();
  fileMsg(t('restored').replace('{n}', Object.values(merged.days).filter((n) => n > 0).length));
});

// ---------- feedback by email ----------
$('feedbackBtn').hidden = !FEEDBACK_EMAIL;
$('feedbackBtn').addEventListener('click', () => {
  let info = navigator.userAgent;
  try { if (window.AndroidBridge && window.AndroidBridge.appInfo) info = window.AndroidBridge.appInfo(); } catch { /* not in the app */ }
  location.href = `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent('Suryanamaskar app feedback')}&body=${encodeURIComponent(`\n\n\n---\n${info}`)}`;
});
$('weight').addEventListener('input', renderProfile);
$('height').addEventListener('input', renderProfile);

// appearance: follow the phone, or force light / dark
function applyTheme() {
  const v = $('theme').value;
  if (v === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', v);
  const dark = v === 'dark' || (v === 'system' && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
  try { if (window.AndroidBridge && window.AndroidBridge.setDark) window.AndroidBridge.setDark(dark); } catch { /* not in the app */ }
}
$('theme').addEventListener('change', applyTheme);
if (window.matchMedia) matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

document.querySelectorAll('#period button').forEach((b) => b.addEventListener('click', () => {
  period = Number(b.dataset.p);
  document.querySelectorAll('#period button').forEach((x) => x.classList.toggle('active', x === b));
  renderProgress();
}));

$('strictness').addEventListener('change', () => { counter.o.mode = $('strictness').value; });

// ---------- daily reminder (only inside the Android app) ----------
const canRemind = () => !!(window.AndroidBridge && window.AndroidBridge.setReminder);
function lastPractisedDay() {
  const days = store.get('days', {});
  return Object.keys(days).filter((k) => days[k] > 0).sort().pop() || '';
}
// Without a plan the reminder is skipped on a day already practised. With a plan it is skipped only once
// today's plan is finished; a day with some rounds done gets "N rounds left in today's plan".
function syncReminder() {
  if (!canRemind()) return;
  $('remindTimeRow').hidden = !$('remind').checked;
  const p = planToday();
  $('remindNote').hidden = !$('remind').checked;
  $('remindNote').textContent = t(p ? 'remNotePlan' : 'remNote');
  const [hh, mm] = ($('remindTime').value || '06:00').split(':').map(Number);
  const streak = currentStreak();
  const text = streak > 1 ? t('remStreak').replace('{n}', streak) : t('remText');
  let doneDay = lastPractisedDay(), partDay = '', partText = '';
  if (p) {
    doneDay = p.remaining ? '' : dayKey();
    if (p.remaining && p.done) { partDay = dayKey(); partText = t('remPlanLeft').replace('{n}', p.remaining); }
  }
  try {
    if (window.AndroidBridge.setReminder2) window.AndroidBridge.setReminder2($('remind').checked, hh || 0, mm || 0, t('appName'), text, doneDay, partDay, partText);
    else window.AndroidBridge.setReminder($('remind').checked, hh || 0, mm || 0, t('appName'), text, doneDay);
  } catch (e) { console.error(e); }
}
if (canRemind()) {
  $('remindRow').hidden = false;
  $('remind').checked = store.get('remind', false);
  $('remindTime').value = store.get('remindTime', '06:00');
  $('remind').addEventListener('change', () => { store.set('remind', $('remind').checked); syncReminder(); });
  $('remindTime').addEventListener('change', () => { store.set('remindTime', $('remindTime').value); syncReminder(); });
}

// ---------- first-run guide ----------
const introArt = $('introArt');
const ictx = introArt.getContext('2d');
let introPage = 0;
const INTRO = [['g1t', 'g1'], ['g2t', 'g2'], ['g3t', 'g3'], ['g4t', 'g4'], ['g5t', 'g5']];
function drawIntro(page) {
  const W = introArt.width, H = introArt.height;
  const css = getComputedStyle(document.documentElement);
  const sun = css.getPropertyValue('--sun').trim(), sun2 = css.getPropertyValue('--sun2').trim();
  const ink = css.getPropertyValue('--muted').trim(), line = css.getPropertyValue('--line').trim();
  ictx.clearRect(0, 0, W, H);
  const ground = H - 70;
  const figure = (pose, cx, scale) => {
    const X = (p) => cx + p[0] * scale, Y = (p) => ground + p[1] * scale;
    const limb = (pts, w, color) => { ictx.strokeStyle = color; ictx.lineWidth = w * scale; ictx.lineCap = 'round'; ictx.lineJoin = 'round';
      ictx.beginPath(); ictx.moveTo(X(pts[0]), Y(pts[0])); pts.slice(1).forEach((p) => ictx.lineTo(X(p), Y(p))); ictx.stroke(); };
    limb([pose.hip, pose.knB, pose.anB], 5.5, sun2); limb([pose.hip, pose.sh], 7.5, sun);
    limb([pose.hip, pose.knA, pose.anA], 5.5, sun); limb([pose.sh, pose.el, pose.wr], 4, sun);
    ictx.fillStyle = sun; ictx.beginPath(); ictx.arc(X(pose.head), Y(pose.head), 6.2 * scale, 0, Math.PI * 2); ictx.fill();
  };
  ictx.strokeStyle = line; ictx.lineWidth = 3; ictx.beginPath(); ictx.moveTo(30, ground + 12); ictx.lineTo(W - 30, ground + 12); ictx.stroke();
  const phone = (x) => { ictx.fillStyle = ink; ictx.beginPath(); ictx.roundRect(x, ground - 96, 46, 96, 9); ictx.fill();
    ictx.fillStyle = sun2; ictx.beginPath(); ictx.arc(x + 23, ground - 80, 5, 0, Math.PI * 2); ictx.fill(); };
  if (page === 0) {
    ictx.clearRect(0, 0, W, H);
    if (guidePhoto.complete && guidePhoto.naturalWidth) {
      ictx.save();
      ictx.beginPath(); ictx.roundRect((W - H) / 2, 0, H, H, 28); ictx.clip();
      ictx.drawImage(guidePhoto, (W - H) / 2, 0, H, H);
      ictx.restore();
    } else {
      ictx.fillStyle = sun2; ictx.beginPath(); ictx.arc(W / 2, ground - 150, 120, 0, Math.PI * 2); ictx.fill();
      figure(POSES[1], W / 2 + 10, 4);
    }
  } else if (page === 1) {
    phone(60);
    ictx.strokeStyle = ink; ictx.lineWidth = 3; ictx.setLineDash([12, 10]);
    ictx.beginPath(); ictx.moveTo(125, ground + 40); ictx.lineTo(W - 150, ground + 40); ictx.stroke(); ictx.setLineDash([]);
    ictx.fillStyle = ink; ictx.font = '600 30px system-ui, sans-serif'; ictx.textAlign = 'center'; ictx.fillText('2 – 3 m', (125 + W - 150) / 2, ground + 34 - 10);
    figure(POSES[0], W - 130, 4);
  } else if (page === 2) {
    phone(60);
    ictx.strokeStyle = sun2; ictx.lineWidth = 5; ictx.lineCap = 'round';
    for (const r of [34, 58, 82]) { ictx.beginPath(); ictx.arc(106, ground - 60, r, -0.6, 0.6); ictx.stroke(); }
    figure(POSES[7], W - 190, 3.6);
  } else {
    ictx.strokeStyle = sun; ictx.lineWidth = 16; ictx.lineCap = 'round';
    ictx.beginPath(); ictx.arc(W / 2, ground - 170, 52, Math.PI, 0); ictx.stroke();
    ictx.beginPath(); ictx.moveTo(W / 2 - 52, ground - 170); ictx.lineTo(W / 2 - 52, ground - 130); ictx.moveTo(W / 2 + 52, ground - 170); ictx.lineTo(W / 2 + 52, ground - 130); ictx.stroke();
    ictx.fillStyle = sun; ictx.beginPath(); ictx.roundRect(W / 2 - 84, ground - 136, 168, 124, 20); ictx.fill();
    ictx.fillStyle = sun2; ictx.beginPath(); ictx.arc(W / 2, ground - 84, 15, 0, Math.PI * 2); ictx.fill();
  }
}
function showIntro(page) {
  introPage = page;
  $('introTitle').textContent = t(INTRO[page][0]);
  $('introText').textContent = t(INTRO[page][1]);
  $('introLangRow').hidden = page !== 0;
  $('introProfile').hidden = page !== 4;
  introArt.hidden = page === 4;
  $('introText').style.flex = page === 4 ? 'none' : '';
  $('introNext').textContent = t(page === INTRO.length - 1 ? 'getStarted' : 'next');
  const dotsEl = $('introDots');
  dotsEl.textContent = '';
  INTRO.forEach((_, i) => { const d = document.createElement('span'); if (i === page) d.className = 'on'; dotsEl.append(d); });
  if (page !== 4) drawIntro(page);
}
function openIntro() {
  $('introLang').value = lang;
  $('introWeight').value = $('weight').value; $('introHeight').value = $('height').value;
  $('intro').hidden = false; showIntro(0);
}
guidePhoto.addEventListener('load', () => { if (!$('intro').hidden && introPage === 0) drawIntro(0); });
for (const [from, to] of [['introWeight', 'weight'], ['introHeight', 'height']]) {
  $(from).addEventListener('input', () => { $(to).value = $(from).value; store.set(to, $(to).value); renderProfile(); });
}
function closeIntro() { $('intro').hidden = true; store.set('introSeen', true); if (!store.get('healthSeen', false)) openHealth(); }

// ---------- health and safety notice ----------
function openHealth() { $('health').hidden = false; $('health').scrollTop = 0; }
$('healthOk').addEventListener('click', () => { $('health').hidden = true; store.set('healthSeen', true); });
$('healthBtn').addEventListener('click', openHealth);
$('introNext').addEventListener('click', () => (introPage === INTRO.length - 1 ? closeIntro() : showIntro(introPage + 1)));
$('introSkip').addEventListener('click', closeIntro);
$('introLang').addEventListener('change', () => { lang = $('introLang').value; $('lang').value = lang; store.set('lang', lang); applyLang(); showIntro(introPage); });
$('howTo').addEventListener('click', openIntro);

applyTheme();
applyLang();
syncReminder();
if (!store.get('introSeen', false)) openIntro();
else if (!store.get('healthSeen', false)) openHealth();
renderLastSummary();
requestAnimationFrame(animLoop);
