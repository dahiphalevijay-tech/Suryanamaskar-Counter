import { POSES, POSE_INFO, lerpPose } from './poses.js';
import { RepCounter } from './counter.js';
import { STR, SPEECH_LANG } from './i18n.js';

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
}

// ---------- progress data ----------
const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function addToday(n) {
  if (!n) return;
  const days = store.get('days', {});
  days[dayKey()] = Math.max(0, (days[dayKey()] || 0) + n);
  store.set('days', days);
}
function renderProgress() {
  const days = store.get('days', {});
  const today = days[dayKey()] || 0;
  $('todayBig').textContent = today;
  $('sToday').textContent = today;
  $('sTotal').textContent = Object.values(days).reduce((a, b) => a + b, 0);
  let streak = 0;
  const d = new Date();
  if (!days[dayKey(d)]) d.setDate(d.getDate() - 1);
  while (days[dayKey(d)] > 0) { streak += 1; d.setDate(d.getDate() - 1); }
  $('sStreak').textContent = streak;
  const bars = $('bars');
  bars.textContent = '';
  const vals = [];
  for (let i = 13; i >= 0; i--) { const x = new Date(); x.setDate(x.getDate() - i); vals.push([x.getDate(), days[dayKey(x)] || 0]); }
  const max = Math.max(1, ...vals.map((v) => v[1]));
  for (const [date, v] of vals) {
    const col = document.createElement('div');
    const bar = document.createElement('i');
    bar.style.height = `${(v / max) * 80}%`;
    bar.title = String(v);
    col.append(bar, document.createTextNode(String(date)));
    bars.append(col);
  }
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

async function loadModel() {
  if (landmarker) return;
  const vision = await import('./vendor/tasks-vision/vision_bundle.js');
  const files = await vision.FilesetResolver.forVisionTasks('./vendor/tasks-vision/wasm');
  const make = (delegate) => vision.PoseLandmarker.createFromOptions(files, {
    baseOptions: { modelAssetPath: './vendor/pose_landmarker_lite.task', delegate },
    runningMode: 'VIDEO', numPoses: 1,
  });
  try { landmarker = await make('GPU'); } catch { landmarker = await make('CPU'); }
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
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: $('facing').value, width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
    cam.srcObject = stream;
    await cam.play();
  } catch (e) {
    console.error(e); showError(`${t('camError')}\n[${e && (e.name || '')} ${e && (e.message || e)}]`); resetStart(); return;
  }
  try { if (navigator.wakeLock) wakeLock = await navigator.wakeLock.request('screen'); } catch { /* optional */ }
  counter.reset();
  sessionCount = 0;
  $('count').textContent = '0';
  $('idle').hidden = true; $('live').hidden = false;
  running = true;
  requestAnimationFrame(loop);
}
function resetStart() { $('start').disabled = false; $('start').textContent = t('start'); }

function stop() {
  running = false;
  if (stream) { stream.getTracks().forEach((x) => x.stop()); stream = null; }
  if (wakeLock) { try { wakeLock.release(); } catch { /* ignore */ } wakeLock = null; }
  addToday(sessionCount);
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
  try { const res = landmarker.detectForVideo(cam, now); lm = res.landmarks && res.landmarks[0]; } catch (e) { console.error(e); }
  const out = counter.update(lm || null, now, W / H);

  const mirror = $('facing').value === 'user';
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

  $('hint').textContent = t(out.stage);
  if ($('dbg').checked) { $('debug').hidden = false; $('debug').textContent = `h ${out.h.toFixed(2)}\nk ${out.k.toFixed(2)}\n${counter.state}`; }
  else $('debug').hidden = true;

  if (out.counted) {
    sessionCount = out.count;
    $('count').textContent = sessionCount;
    speak(sessionCount);
    if (navigator.vibrate) navigator.vibrate(60);
    const target = Number($('target').value);
    if (target && sessionCount === target) { $('hint').textContent = t('done'); speak(t('done')); }
  }
}

$('start').addEventListener('click', start);
$('stop').addEventListener('click', stop);
$('plus').addEventListener('click', () => setCount(sessionCount + 1));
$('minus').addEventListener('click', () => setCount(sessionCount - 1));
document.addEventListener('visibilitychange', () => { if (document.hidden && running) stop(); });

// ---------- settings ----------
$('lang').value = lang;
$('lang').addEventListener('change', () => { lang = $('lang').value; store.set('lang', lang); applyLang(); });
for (const id of ['voice', 'dbg']) {
  $(id).checked = store.get(id, id === 'voice');
  $(id).addEventListener('change', () => store.set(id, $(id).checked));
}
for (const id of ['facing', 'target']) {
  $(id).value = store.get(id, $(id).value);
  $(id).addEventListener('change', () => store.set(id, $(id).value));
}

applyLang();
renderProgress();
requestAnimationFrame(animLoop);
