// Counts suryanamaskars from pose-detector landmarks.
//
// It measures two things, both as a fraction of the person's standing shoulder height:
//   h = how high the shoulders are above the floor
//   k = how high the hips are above the floor
// The counter follows the person through the 12 steps in order. A round runs from standing, down through at
// least one floor pose, and back to standing; it is counted when enough of the 12 steps were recognised:
// 5 for 'easy', 8 for 'standard', all 11 tracked steps for 'strict'.
// Squats and plain forward bends never bring shoulders and hips low together, so they are never counted.

export const DEFAULTS = {
  upH: 0.85,        // shoulders at least this high = standing
  upLean: 0.25,     // max sideways shoulder-hip offset while standing
  floorK: 0.38,     // hips at most this high = floor pose ...
  floorH: 0.5,      // ... together with shoulders at most this high
  dwellMs: 250,     // a state must hold this long before it is believed
  minRepMs: 2500,   // one suryanamaskar cannot be faster than this
  calibMs: 1000,    // stand still this long to calibrate
  minBody: 0.25,    // body must fill this fraction of the frame height
  lostMs: 1500,
  smooth: 0.45,
  mode: 'standard',   // 'easy' | 'standard' | 'strict'
  easySteps: 5,       // 'easy' needs at least this many of the 12 steps recognised
  standardSteps: 8,   // 'standard' needs at least this many
  stepDwellMs: 150,   // a step must be held this long to be recognised
  skipDwellMs: 200,   // extra hold needed for each step that would be skipped
  lookAhead: 4,       // how far ahead in the sequence a recognised step may be
  stillTol: 0.04,     // how much the body may move (fraction of its height) and still count as standing still
  recalDiff: 0.1,     // a still, upright stance this different from the calibration triggers a fresh calibration
  stallMs: 25000,     // no new step for this long abandons the round in progress
  gapResetMs: 5000,   // this long without a usable picture abandons the round in progress
  abandonMs: 1000,    // standing this long in the middle of a round abandons it
};

// How each of the 12 steps looks, in terms of the measurements below. All are fractions of standing shoulder height.
//   h = shoulder height, k = hip height, raise = wrists above shoulders,
//   sep = distance between the two feet, reach = shoulders ahead of the feet
const RAISE = 0.02;
// The app works from the side only: the camera must see the person in profile. (Facing the camera, a leg
// stepping back or hands reaching forward cannot be seen, so the lunges and mountain pose cannot be checked.)
// These numbers were checked against real side-on recordings.
const bend = (f) => f.k > 0.45 && f.h < 0.68 && f.reach < 0.4;
const lunge = (f) => f.k < 0.42 && f.sep > 0.4 && f.h > 0.25;
export const STEP_RULES = [
  (f) => f.h > 0.85 && f.raise < RAISE,                                                  // 1 prayer
  (f) => f.h > 0.8 && f.raise >= RAISE,                                                  // 2 raised arms
  bend,                                                                                  // 3 forward bend
  lunge,                                                                                 // 4 lunge
  (f) => f.k < 0.42 && f.k > 0.15 && f.h > 0.28 && f.h < 0.6 && f.sep < 0.4 && f.h - f.k < 0.25, // 5 plank
  (f) => f.h < 0.22 && f.k < 0.42,                                                       // 6 eight-point
  (f) => f.k < 0.22 && f.h - f.k > 0.18,                                                 // 7 cobra
  (f) => f.k > 0.45 && f.h < 0.5 && f.reach >= 0.4,                                      // 8 mountain
  lunge,                                                                                 // 9 lunge, other leg
  bend,                                                                                  // 10 forward bend
  null,                                                                                  // 11 raised arms: not tracked
  (f) => f.h > 0.85 && f.raise < RAISE,                                                  // 12 prayer
];
// Step 11 (raised arms on the way up) is left out of the count: many people go from the forward bend
// straight to prayer pose. Doing it does no harm; it is simply not looked for.
export const TRACKED_STEPS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12];
const FLOOR_STEPS = [4, 5, 6, 7, 9];

const VIS = 0.5;

function avg(lm, a, b, min = VIS) {
  const A = lm[a], B = lm[b];
  const va = A && A.visibility >= min, vb = B && B.visibility >= min;
  if (va && vb) return { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
  if (va) return { x: A.x, y: A.y };
  if (vb) return { x: B.x, y: B.y };
  return null;
}

export class RepCounter {
  constructor(opts = {}) {
    this.o = { ...DEFAULTS, ...opts };
    this.reset();
  }

  reset() {
    this.count = 0;
    this.recalibrate();
  }

  recalibrate() {
    this.calibrated = false;
    this.front = false;
    this.H = 0;
    this.floorY = 0;
    this.state = 'up';
    this.s = null;
    this.calibStart = null;
    this.calibSamples = [];
    this.stanceBuf = [];
    this.widthAvg = 0;
    this.condSince = { up: null, floor: null };
    this.leftUpAt = null;
    this.lastSeen = null;
    this.lastGood = null;
    this.h = 0;
    this.k = 0;
    this.feat = { h: 0, k: 0, raise: 0, sep: 0, reach: 0 };
    this.ankleX = null;
    this.facing = 0;
    this._newRound(0);
  }

  // Tracks whether the person is upright (shoulders over hips over feet) and has kept still for calibMs.
  _stance(landmarks, s, feetY, t, aspect) {
    const o = this.o;
    const body = feetY - s.shY;
    const hipFrac = body > 0 ? (s.hipY - s.shY) / body : 0;
    const lean = body > 0 ? Math.abs(s.shX - s.hipX) * aspect / body : 1;
    const far = body < o.minBody;
    const upright = !far && hipFrac > 0.28 && hipFrac < 0.58 && lean < 0.2;
    if (!upright) { this.stanceBuf = []; return { held: false, upright, far }; }
    const L = landmarks[11], R = landmarks[12];
    const width = L && R && L.visibility >= VIS && R.visibility >= VIS ? Math.abs(L.x - R.x) * aspect / body : 0;
    const buf = this.stanceBuf;
    buf.push({ t, body, feetY, shY: s.shY, shX: s.shX * aspect, width });
    while (buf.length && t - buf[0].t > o.calibMs) buf.shift();
    const span = (k) => Math.max(...buf.map((b) => b[k])) - Math.min(...buf.map((b) => b[k]));
    const still = span('shY') < o.stillTol * body && span('feetY') < o.stillTol * body && span('shX') < o.stillTol * body;
    if (!still) { this.stanceBuf = buf.slice(-1); return { held: false, upright, far }; }
    const mean = (k) => buf.reduce((x, b) => x + b[k], 0) / buf.length;
    const held = buf.length >= 4 && t - buf[0].t >= o.calibMs * 0.9;
    return { held, upright, far, body: mean('body'), floor: mean('feetY'), width: mean('width') };
  }

  _calibrate(stance, t) {
    this.H = stance.body;
    this.floorY = stance.floor;
    this.widthAvg = stance.width;
    this.front = stance.width > 0.15;
    this.calibrated = true;
    this.calibSeq = (this.calibSeq || 0) + 1;   // lets the app notice each fresh calibration
    this.state = 'up';
    this.leftUpAt = null;
    this.condSince = { up: null, floor: null };
    this.stanceBuf = [];
    this._newRound(t);
  }

  _newRound(t) {
    this.step = 1;                        // last step recognised in this round (1..12)
    this.seen = new Array(13).fill(false);
    this.seen[1] = true;
    this.cand = { step: 0, since: 0 };
    this.roundStart = t;
    this.upSince = null;
    this.lastStepAt = t;
  }

  // Follows the person through the 12 steps. Returns 'done', 'abandoned' or null.
  _track(f, t, isUp) {
    const o = this.o;
    let hit = 0;
    for (let j = this.step + 1; j <= Math.min(12, this.step + o.lookAhead); j++) {
      if (!STEP_RULES[j - 1]) continue;
      if (j === 12 && !FLOOR_STEPS.some((x) => this.seen[x])) continue;
      // the way back up (steps 9 onward) only opens once the lowest poses have been reached
      if (j >= 9 && !(this.seen[6] || this.seen[7] || this.seen[8])) continue;
      // mountain pose comes after the floor poses; before them, the same shape is just a deep forward bend
      if (j === 8 && !(this.seen[5] || this.seen[6] || this.seen[7])) continue;
      if (STEP_RULES[j - 1](f)) { hit = j; break; }
    }
    if (hit) {
      if (this.cand.step !== hit) this.cand = { step: hit, since: t };
      const skipped = TRACKED_STEPS.filter((x) => x > this.step && x < hit).length;
      const need = o.stepDwellMs + o.skipDwellMs * skipped;
      if (t - this.cand.since >= need) {
        if (this.step === 1) this.roundStart = this.cand.since;
        this.step = hit;
        this.lastStepAt = t;
        this.seen[hit] = true;
        this.cand = { step: 0, since: 0 };
        if (hit === 12) return 'done';
      }
    } else this.cand = { step: 0, since: 0 };

    // standing still in the middle of a round: the person gave up on it
    if (isUp && this.step > 2 && this.step < 10) {
      if (this.upSince === null) this.upSince = t;
      if (t - this.upSince >= o.abandonMs) return 'abandoned';
    } else this.upSince = null;
    // nothing new for a long time: whatever was in progress is over
    if (this.step > 1 && t - this.lastStepAt > o.stallMs) return 'stalled';
    return null;
  }

  _held(name, on, t) {
    if (!on) { this.condSince[name] = null; return false; }
    if (this.condSince[name] === null) this.condSince[name] = t;
    return t - this.condSince[name] >= this.o.dwellMs;
  }

  // landmarks: 33 normalised points; t: milliseconds; aspect: frame width / height
  update(landmarks, t, aspect = 1) {
    const o = this.o;
    const sh = landmarks && avg(landmarks, 11, 12);
    const hip = landmarks && avg(landmarks, 23, 24);
    let feetY = null;
    if (landmarks) {
      for (const i of [27, 28, 29, 30, 31, 32]) {
        const p = landmarks[i];
        if (p && p.visibility >= 0.3 && (feetY === null || p.y > feetY)) feetY = p.y;
      }
    }
    const usable = sh && hip && (feetY !== null || this.calibrated);
    if (!usable) {
      const lost = this.lastSeen === null || t - this.lastSeen > o.lostMs;
      if (lost) { this.calibStart = null; this.calibSamples = []; }
      if (this.calibrated) return this._gap(t, lost);
      return this._out(lost ? 'lost' : this._stage(), false);
    }
    this.lastSeen = t;

    const a = o.smooth;
    if (!this.s) this.s = { shX: sh.x, shY: sh.y, hipX: hip.x, hipY: hip.y };
    else {
      this.s.shX += (sh.x - this.s.shX) * a; this.s.shY += (sh.y - this.s.shY) * a;
      this.s.hipX += (hip.x - this.s.hipX) * a; this.s.hipY += (hip.y - this.s.hipY) * a;
    }
    const s = this.s;

    // Is the person standing upright and still right now? (Judged without using the calibration.)
    const stance = feetY === null ? null : this._stance(landmarks, s, feetY, t, aspect);
    if (!this.calibrated) {
      if (!stance) return this._out('stand', true);
      if (!stance.held) return this._out(stance.far ? 'far' : (stance.upright ? 'calibrating' : 'stand'), true);
      this._calibrate(stance, t);
      return this._out('calibrating', true);
    }
    // Standing still at a clearly different size or floor level than at calibration means the person (or the
    // phone) has moved since then, so measure again instead of counting against the old numbers.
    if (stance && stance.held && (Math.abs(stance.body - this.H) / this.H > o.recalDiff
        || Math.abs(stance.floor - this.floorY) / this.H > o.recalDiff)) {
      this._calibrate(stance, t);
      return this._out('calibrating', true);
    }

    this.h = (this.floorY - s.shY) / this.H;
    this.k = (this.floorY - s.hipY) / this.H;
    // Measurements no body can produce mean the detector is guessing (person too close, walking past, half out
    // of the picture). Ignore those frames; after a long gap, give up on the round that was in progress.
    const plausible = this.h > -0.05 && this.h < 1.2 && this.k > -0.08 && this.k < 0.8;
    if (!plausible) return this._gap(t);
    this.lastGood = t;
    const lean = Math.abs(s.shX - s.hipX) * aspect / this.H;
    const isUp = this.h > o.upH && lean < o.upLean;
    const isFloor = this.k < o.floorK && this.h < o.floorH;
    if (isUp) {
      // people often face the phone to start and then turn side-on, so keep judging the view while they stand
      const L = landmarks[11], R = landmarks[12];
      if (L && R && L.visibility >= VIS && R.visibility >= VIS) {
        this.widthAvg += (Math.abs(L.x - R.x) * aspect / this.H - this.widthAvg) * 0.2;
        if (this.widthAvg > 0.16) this.front = true;
        else if (this.widthAvg < 0.13) this.front = false;
      }
    }
    const upHeld = this._held('up', isUp, t);
    const floorHeld = this._held('floor', isFloor, t);
    let counted = false;
    let rejected = false;

    // extra measurements for following the individual steps
    const wr = avg(landmarks, 15, 16, 0.3);
    const aL = landmarks[27], aR = landmarks[28];
    const okL = aL && aL.visibility >= 0.3, okR = aR && aR.visibility >= 0.3;
    if (okL || okR) this.ankleX = okL && okR ? (aL.x + aR.x) / 2 : (okL ? aL.x : aR.x);
    const dx = (s.shX - s.hipX) * aspect / this.H;
    if (Math.abs(dx) > 0.3) this.facing = Math.sign(dx);
    const f = this.feat = {
      front: this.front,
      h: this.h,
      k: this.k,
      raise: wr ? (sh.y - wr.y) / this.H : -1,
      sep: okL && okR ? Math.abs(aL.x - aR.x) * aspect / this.H : 0,
      reach: this.ankleX === null ? 0 : Math.abs(s.shX - this.ankleX) * aspect / this.H,
    };
    if (this.front) {
      // facing the camera: nothing is counted until the person turns side-on
      if (this.step > 1 || this.state !== 'up') { this.state = 'up'; this.leftUpAt = null; this._newRound(t); }
      return this._out('turn', true);
    }
    const tracked = this._track(f, t, isUp);
    if (tracked === 'done') {
      const seenCount = this.seen.filter(Boolean).length;
      const need = o.mode === 'strict' ? TRACKED_STEPS.length : (o.mode === 'easy' ? o.easySteps : o.standardSteps);
      if (seenCount >= need && t - this.roundStart >= o.minRepMs) {
        this.count += 1; counted = true;
        this.lastRound = { ms: t - this.roundStart, seen: this.seen.slice() };
      }
      else rejected = true;
      this._newRound(t);
    } else if (tracked === 'stalled') {
      this._newRound(t);
    } else if (tracked === 'abandoned') {
      if (FLOOR_STEPS.some((x) => this.seen[x])) rejected = true;
      this._newRound(t);
    }

    if (this.state === 'up') {
      if (isUp) {
        this.leftUpAt = null;
        // slow drift correction while standing
        if (feetY !== null) {
          this.floorY += (feetY - this.floorY) * 0.02;
          this.H += ((feetY - s.shY) - this.H) * 0.02;
        }
      } else if (this.leftUpAt === null) this.leftUpAt = t;
      if (floorHeld) this.state = 'floor';
    } else if (this.state === 'floor') {
      const started = this.leftUpAt === null ? t : this.leftUpAt;
      if (upHeld && t - started >= o.minRepMs) {
        this.state = 'up';
        this.leftUpAt = null;
      }
    }
    return this._out(this._stage(isUp, isFloor), true, counted, rejected);
  }

  // A frame with nothing usable in it. A long run of these abandons the round in progress.
  _gap(t, lost = true) {
    if (this.lastGood !== null && t - this.lastGood > this.o.gapResetMs && (this.state !== 'up' || this.step > 1)) {
      this.state = 'up';
      this.leftUpAt = null;
      this.condSince = { up: null, floor: null };
      this._newRound(t);
    }
    const quiet = this.lastGood === null || t - this.lastGood > this.o.lostMs;
    return this._out(lost && quiet ? 'lost' : this._stage(), false);
  }

  _stage(isUp, isFloor) {
    if (!this.calibrated) return 'stand';
    if (isFloor) return 'floor';
    if (isUp) return 'up';
    return this.state === 'up' ? 'down' : 'rise';
  }

  _out(stage, visible, counted = false, rejected = false) {
    return {
      count: this.count, stage, visible, counted, rejected, calibrated: this.calibrated,
      h: this.h, k: this.k, feat: this.feat, step: this.step,
      next: this.step >= 12 ? 1 : TRACKED_STEPS[TRACKED_STEPS.indexOf(this.step) + 1],
      seen: this.seen, facing: this.facing, front: this.front,
      round: counted ? this.lastRound : null, calibSeq: this.calibSeq || 0,
    };
  }
}
