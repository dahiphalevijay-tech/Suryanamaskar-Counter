// Counts suryanamaskars from pose-detector landmarks.
//
// It measures two things, both as a fraction of the person's standing shoulder height:
//   h = how high the shoulders are above the floor
//   k = how high the hips are above the floor
// 'easy' mode: one suryanamaskar = standing upright -> floor poses (plank / eight-point / cobra) -> standing upright.
// 'standard' and 'strict' modes also follow the person through the 12 steps in order and only count a round
// in which enough of the steps were recognised (8 of 12 for standard, all 12 for strict).
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
  standardSteps: 8,   // 'standard' needs at least this many of the 12 steps recognised
  stepDwellMs: 150,   // a step must be held this long to be recognised
  skipDwellMs: 200,   // extra hold needed for each step that would be skipped
  lookAhead: 4,       // how far ahead in the sequence a recognised step may be
  abandonMs: 1000,    // standing this long in the middle of a round abandons it
};

// How each of the 12 steps looks, in terms of the measurements below. All are fractions of standing shoulder height.
//   h = shoulder height, k = hip height, raise = wrists above shoulders,
//   sep = distance between the two feet, reach = shoulders ahead of the feet
export const STEP_RULES = [
  (f) => f.h > 0.85 && f.raise < 0.15,                                                   // 1 prayer
  (f) => f.h > 0.8 && f.raise > 0.15,                                                    // 2 raised arms
  (f) => f.k > 0.45 && f.h < 0.68 && f.reach < 0.4,                                      // 3 forward bend
  (f) => f.k < 0.42 && f.sep > 0.4 && f.h > 0.25,                                        // 4 lunge
  (f) => f.k < 0.42 && f.k > 0.15 && f.h > 0.28 && f.h < 0.6 && f.sep < 0.4 && f.h - f.k < 0.25, // 5 plank
  (f) => f.h < 0.22 && f.k < 0.42,                                                       // 6 eight-point
  (f) => f.k < 0.22 && f.h - f.k > 0.18,                                                 // 7 cobra
  (f) => f.k > 0.45 && f.h < 0.5 && f.reach >= 0.4,                                      // 8 mountain
];
STEP_RULES[8] = STEP_RULES[3];   // 9 lunge, other leg
STEP_RULES[9] = STEP_RULES[2];   // 10 forward bend
STEP_RULES[10] = STEP_RULES[1];  // 11 raised arms
STEP_RULES[11] = STEP_RULES[0];  // 12 prayer
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
    this.H = 0;
    this.floorY = 0;
    this.state = 'up';
    this.s = null;
    this.calibStart = null;
    this.calibSamples = [];
    this.condSince = { up: null, floor: null };
    this.leftUpAt = null;
    this.lastSeen = null;
    this.h = 0;
    this.k = 0;
    this.feat = { h: 0, k: 0, raise: 0, sep: 0, reach: 0 };
    this.ankleX = null;
    this.facing = 0;
    this._newRound(0);
  }

  _newRound(t) {
    this.step = 1;                        // last step recognised in this round (1..12)
    this.seen = new Array(13).fill(false);
    this.seen[1] = true;
    this.cand = { step: 0, since: 0 };
    this.roundStart = t;
    this.upSince = null;
  }

  // Follows the person through the 12 steps. Returns 'done', 'abandoned' or null.
  _track(f, t, isUp) {
    const o = this.o;
    let hit = 0;
    for (let j = this.step + 1; j <= Math.min(12, this.step + o.lookAhead); j++) {
      if (j === 12 && !FLOOR_STEPS.some((x) => this.seen[x])) continue;
      if (STEP_RULES[j - 1](f)) { hit = j; break; }
    }
    if (hit) {
      if (this.cand.step !== hit) this.cand = { step: hit, since: t };
      const need = o.stepDwellMs + o.skipDwellMs * (hit - this.step - 1);
      if (t - this.cand.since >= need) {
        if (this.step === 1) this.roundStart = this.cand.since;
        this.step = hit;
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

    if (!this.calibrated) {
      const body = feetY - s.shY;
      const hipFrac = body > 0 ? (s.hipY - s.shY) / body : 0;
      const lean = body > 0 ? Math.abs(s.shX - s.hipX) * aspect / body : 1;
      const upright = body >= o.minBody && hipFrac > 0.28 && hipFrac < 0.58 && lean < 0.2;
      if (!upright) {
        this.calibStart = null; this.calibSamples = [];
        return this._out(body < o.minBody ? 'far' : 'stand', true);
      }
      if (this.calibStart === null) this.calibStart = t;
      this.calibSamples.push({ body, feetY });
      if (t - this.calibStart >= o.calibMs) {
        const n = this.calibSamples.length;
        this.H = this.calibSamples.reduce((x, c) => x + c.body, 0) / n;
        this.floorY = this.calibSamples.reduce((x, c) => x + c.feetY, 0) / n;
        this.calibrated = true;
        this.state = 'up';
        this.condSince = { up: null, floor: null };
      }
      return this._out('calibrating', true);
    }

    this.h = (this.floorY - s.shY) / this.H;
    this.k = (this.floorY - s.hipY) / this.H;
    const lean = Math.abs(s.shX - s.hipX) * aspect / this.H;
    const isUp = this.h > o.upH && lean < o.upLean;
    const isFloor = this.k < o.floorK && this.h < o.floorH;
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
      h: this.h,
      k: this.k,
      raise: wr ? (sh.y - wr.y) / this.H : -1,
      sep: okL && okR ? Math.abs(aL.x - aR.x) * aspect / this.H : 0,
      reach: this.ankleX === null ? 0 : Math.abs(s.shX - this.ankleX) * aspect / this.H,
    };
    const tracked = this._track(f, t, isUp);
    if (tracked === 'done') {
      const seenCount = this.seen.filter(Boolean).length;
      const need = o.mode === 'strict' ? 12 : o.standardSteps;
      if (o.mode !== 'easy') {
        if (seenCount >= need && t - this.roundStart >= o.minRepMs) { this.count += 1; counted = true; }
        else rejected = true;
      }
      this._newRound(t);
    } else if (tracked === 'abandoned') {
      if (o.mode !== 'easy' && FLOOR_STEPS.some((x) => this.seen[x])) rejected = true;
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
        if (o.mode === 'easy') { this.count += 1; counted = true; this._newRound(t); }
        this.state = 'up';
        this.leftUpAt = null;
      }
    }
    return this._out(this._stage(isUp, isFloor), true, counted, rejected);
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
      h: this.h, k: this.k, feat: this.feat, step: this.step, next: this.step >= 12 ? 1 : this.step + 1,
      seen: this.seen, facing: this.facing,
    };
  }
}
