import { POSES, POSE_INFO, lerpPose } from './poses.js';
import { RepCounter, TRACKED_STEPS } from './counter.js';
import { STR, SPEECH_LANG } from './i18n.js';
import { dayKey, kcalFor, bmi, summarize } from './stats.js';

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
  $('play').textContent = t(playing ? 'pause' : 'play');
  showPose(Math.round(animPos) % 12);
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
  $('todayBig').textContent = today;
  $('sToday').textContent = today;
  $('sTotal').textContent = Object.values(days).reduce((a, b) => a + b, 0);
  let streak = 0;
  const d = new Date();
  if (!days[dayKey(d)]) d.setDate(d.getDate() - 1);
  while (days[dayKey(d)] > 0) { streak += 1; d.setDate(d.getDate() - 1); }
  $('sStreak').textContent = streak;

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
const guide = $('guide');
const gctx = guide.getContext('2d');
const dots = $('dots');
for (const step of TRACKED_STEPS) { const d = document.createElement('span'); d.dataset.step = step; dots.append(d); }
const LINKS = [[11, 13], [13, 15], [12, 14], [14, 16], [11, 12], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28], [27, 31], [28, 32]];

function speak(text) {
  if (!$('voice').checked) return;
  try {
    if (window.AndroidBridge && window.AndroidBridge.speak) { window.AndroidBridge.speak(String(text), SPEECH_LANG[lang]); return; }
    if ('speechSynthesis' in window) {
      const u = new SpeechSynthesisUtterance(String(text));
      u.lang = SPEECH_LANG[lang]; u.rate = 1.1;
      speechSynthesis.cancel(); speechSynthesis.speak(u);
    }
  } catch { /* speech not available */ }
}
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

async function loadModel(kind = 'full') {
  if (landmarker && modelKind === kind) return;
  if (!vision) {
    vision = await import('./vendor/tasks-vision/vision_bundle.js');
    visionFiles = await vision.FilesetResolver.forVisionTasks('./vendor/tasks-vision/wasm');
  }
  const make = (delegate) => vision.PoseLandmarker.createFromOptions(visionFiles, {
    baseOptions: { modelAssetPath: `./vendor/pose_landmarker_${kind}.task`, delegate },
    runningMode: 'VIDEO', numPoses: 1,
    // lower than the defaults so the person is not dropped when the face is hidden (forward bend, mountain)
    minPoseDetectionConfidence: 0.3, minPosePresenceConfidence: 0.3, minTrackingConfidence: 0.3,
  });
  let next;
  try { next = await make('GPU'); } catch { next = await make('CPU'); }
  const old = landmarker;
  landmarker = next;
  modelKind = kind;
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
  sess = { t: Date.now(), ms: 0, rounds: 0, rej: 0, steps: new Array(12).fill(0) };
  guide.hidden = true;
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

function stop() {
  running = false;
  if (stream) { stream.getTracks().forEach((x) => x.stop()); stream = null; }
  if (wakeLock) { try { wakeLock.release(); } catch { /* ignore */ } wakeLock = null; }
  addToday(sessionCount);
  if (sess && (sessionCount > 0 || sess.rej > 0)) {
    const kcal = kcalFor(Number($('weight').value), sess.ms, sess.rounds);
    saveSession({ ...sess, n: sessionCount, kcal: Math.round(kcal * 10) / 10 });
  }
  sess = null;
  renderLastSummary();
  $('live').hidden = true; $('idle').hidden = false;
  resetStart();
  renderProgress();
}

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
  let lm = null;
  try {
    const t0 = performance.now();
    const res = landmarker.detectForVideo(cam, now);
    lm = res.landmarks && res.landmarks[0];
    const dt = performance.now() - t0;
    inferN += 1;
    if (inferN > 5) inferMs += (dt - inferMs) / Math.min(inferN - 5, 30);
    if (modelKind === 'full' && inferN > 45 && inferMs > SLOW_MS && !switching) {
      switching = true;
      loadModel('lite').catch((e) => console.error(e)).finally(() => { switching = false; });
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

  // step guide: the small figure shows the next step, the dots show which steps were recognised
  if (out.calibrated && out.visible && out.stage !== 'turn') {
    const target = out.next;
    const info = POSE_INFO[target - 1];
    const phase = (now % 1700) / 1700;
    drawFigure(gctx, lerpPose(POSES[out.step - 1], POSES[target - 1], phase / 0.55), guide.width, guide.height);
    guide.hidden = false;
    const dir = (mirror ? -1 : 1) * (out.facing || 1);
    guide.style.transform = dir < 0 ? 'scaleX(-1)' : '';
    if (now > noticeUntil) $('hint').textContent = `${target}. ${lang === 'en' ? info.en : info.dev} · ${t(info.breath)}`;
    [...dots.children].forEach((d) => { const n = Number(d.dataset.step); d.className = out.seen[n] ? 'on' : (n === target ? 'next' : ''); });
  } else {
    guide.hidden = true;
    if (now > noticeUntil || out.stage === 'turn') $('hint').textContent = t(out.stage);
    if (out.stage === 'turn') [...dots.children].forEach((d) => { d.className = ''; });
  }
  if (out.rejected) {
    if (sess) sess.rej += 1;
    noticeUntil = now + 2500;
    $('hint').textContent = t('notCounted');
    if (navigator.vibrate) navigator.vibrate([40, 60, 40]);
  }
  if ($('optNumbers').checked) {
    const f = out.feat;
    $('tuneBox').hidden = false;
    $('tuneBox').textContent = `${modelKind} ${inferMs.toFixed(0)}ms\nstep ${out.step} ${out.front ? 'front' : 'side'}\nh ${f.h.toFixed(2)}  k ${f.k.toFixed(2)}\nraise ${f.raise.toFixed(2)}\nfeet ${f.sep.toFixed(2)}\nreach ${f.reach.toFixed(2)}`;
  } else $('tuneBox').hidden = true;

  if (out.counted) {
    if (sess && out.round) {
      sess.ms += out.round.ms;
      sess.rounds += 1;
      for (let i = 1; i <= 12; i++) if (out.round.seen[i]) sess.steps[i - 1] += 1;
    }
    sessionCount = out.count;
    $('count').textContent = sessionCount;
    speak(sessionCount);
    if (navigator.vibrate) navigator.vibrate(60);
    const target = Number($('target').value);
    if (target && sessionCount === target) { noticeUntil = now + 4000; $('hint').textContent = t('done'); speak(t('done')); }
  }
}

$('start').addEventListener('click', start);
$('stop').addEventListener('click', stop);
$('plus').addEventListener('click', () => setCount(sessionCount + 1));
$('minus').addEventListener('click', () => setCount(sessionCount - 1));
document.addEventListener('visibilitychange', () => {
  if (document.hidden && running) stop();
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
$('lang').addEventListener('change', () => { lang = $('lang').value; store.set('lang', lang); applyLang(); });
for (const id of ['voice', 'optNumbers']) {
  $(id).checked = store.get(id, id === 'voice');
  $(id).addEventListener('change', () => store.set(id, $(id).checked));
}
for (const id of ['facing', 'target', 'strictness', 'weight', 'height', 'theme']) {
  $(id).value = store.get(id, $(id).value);
  $(id).addEventListener('change', () => store.set(id, $(id).value));
}
$('lens').addEventListener('change', () => store.set('lens', $('lens').value));
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

applyTheme();
applyLang();
renderLastSummary();
requestAnimationFrame(animLoop);
