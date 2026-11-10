// Counts suryanamaskars from pose-detector landmarks.
//
// It measures two things, both as a fraction of the person's standing shoulder height:
//   h = how high the shoulders are above the floor
//   k = how high the hips are above the floor
// One suryanamaskar = standing upright -> floor poses (plank / eight-point / cobra) -> standing upright.
// Squats and plain forward bends never bring shoulders and hips low together, so they are not counted.

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
};

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
        this.count += 1;
        counted = true;
        this.state = 'up';
        this.leftUpAt = null;
      }
    }
    return this._out(this._stage(isUp, isFloor), true, counted);
  }

  _stage(isUp, isFloor) {
    if (!this.calibrated) return 'stand';
    if (isFloor) return 'floor';
    if (isUp) return 'up';
    return this.state === 'up' ? 'down' : 'rise';
  }

  _out(stage, visible, counted = false) {
    return { count: this.count, stage, visible, counted, calibrated: this.calibrated, h: this.h, k: this.k };
  }
}
