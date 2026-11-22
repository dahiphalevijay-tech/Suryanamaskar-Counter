// Form tips: a few common mistakes a side camera can see, measured from the same body points the
// counter uses (no extra model). Each pose is judged over the frames it is held; a tip is spoken
// only when the same mistake shows two rounds running, at most one tip a round.

const VIS = 0.5;
const P = { ear: [7, 8], sh: [11, 12], wr: [15, 16], hip: [23, 24], knee: [25, 26], ank: [27, 28] };

function pt(lm, [a, b], aspect) {
  const A = lm[a], B = lm[b];
  const va = A && A.visibility >= VIS, vb = B && B.visibility >= VIS;
  if (va && vb) return { x: (A.x + B.x) / 2 * aspect, y: (A.y + B.y) / 2 };
  if (va) return { x: A.x * aspect, y: A.y };
  if (vb) return { x: B.x * aspect, y: B.y };
  return null;
}
function angle(a, b, c) {
  const v1 = [a.x - b.x, a.y - b.y], v2 = [c.x - b.x, c.y - b.y];
  const d = Math.hypot(...v1) * Math.hypot(...v2);
  return d ? Math.acos(Math.max(-1, Math.min(1, (v1[0] * v2[0] + v1[1] * v2[1]) / d))) * 180 / Math.PI : 180;
}

// Measurements for one frame of a pose; H = standing height (shoulder to feet) in the same units.
export function measure(lm, step, aspect, H) {
  if (!lm || !H) return null;
  const sh = pt(lm, P.sh, aspect), hip = pt(lm, P.hip, aspect), ank = pt(lm, P.ank, aspect);
  if (step === 5 && sh && hip && ank) {
    // how far the hips sit below (+) or above (−) the straight line from shoulders to ankles
    const L = Math.hypot(ank.x - sh.x, ank.y - sh.y);
    const t = ((hip.x - sh.x) * (ank.x - sh.x) + (hip.y - sh.y) * (ank.y - sh.y)) / (L * L);
    const lineY = sh.y + t * (ank.y - sh.y);
    return { plank: (hip.y - lineY) / L };
  }
  if (step === 7 && hip && ank) return { cobra: (ank.y - hip.y) / H };
  if (step === 8) {
    const knee = pt(lm, P.knee, aspect);
    if (hip && knee && ank) return { dog: angle(hip, knee, ank) };
  }
  if ((step === 2 || step === 11) && sh) {
    const wr = pt(lm, P.wr, aspect), ear = pt(lm, P.ear, aspect), nose = lm[0] && lm[0].visibility >= VIS ? { x: lm[0].x * aspect } : null;
    if (wr && ear && nose && wr.y < sh.y) {
      const face = Math.sign(nose.x - ear.x) || 1;
      return { arms: (wr.x - ear.x) * face / H };
    }
  }
  return null;
}

// Limits, set loose so correct practice is not nagged. The yoga teacher's review may change them.
export const LIMITS = {
  plankSag: (m) => m.plank !== undefined && m.plank > 0.10,
  plankHigh: (m) => m.plank !== undefined && m.plank < -0.20,
  cobraHips: (m) => m.cobra !== undefined && m.cobra > 0.3,
  dogKnees: (m) => m.dog !== undefined && m.dog < 135,
  armsBack: (m) => m.arms !== undefined && m.arms > 0.12,
};
export const TIP_KEYS = Object.keys(LIMITS);
const MEASURE_OF = { plankSag: 'plank', plankHigh: 'plank', cobraHips: 'cobra', dogKnees: 'dog', armsBack: 'arms' };

export class FormCoach {
  constructor() { this.reset(); }
  reset() { this.round = {}; this.prev = new Set(); this.lastTipRound = -9; this.rounds = 0; this.tally = {}; }
  // one frame: which pose (the counter's current step) and the body points
  frame(lm, step, aspect, H) {
    const m = measure(lm, step, aspect, H);
    if (!m) return;
    for (const k of TIP_KEYS) {
      if (!(k in this.round)) this.round[k] = { n: 0, bad: 0 };
      const r = this.round[k];
      if (!(MEASURE_OF[k] in m)) continue;
      r.n += 1;
      if (LIMITS[k](m)) r.bad += 1;
    }
  }
  // end of a counted round: returns the tip key to speak now, or null
  endRound() {
    this.rounds += 1;
    const now = new Set(TIP_KEYS.filter((k) => this.round[k] && this.round[k].n >= 4 && this.round[k].bad / this.round[k].n >= 0.6));
    this.round = {};
    for (const k of now) this.tally[k] = (this.tally[k] || 0) + 1;
    const repeat = TIP_KEYS.find((k) => now.has(k) && this.prev.has(k));
    this.prev = now;
    if (!repeat || this.rounds - this.lastTipRound < 3) return null;
    this.lastTipRound = this.rounds;
    return repeat;
  }
  // the mistake seen in the most rounds (at least two), for the done screen
  mostCommon() {
    let best = null;
    for (const [k, n] of Object.entries(this.tally)) if (n >= 2 && (!best || n > this.tally[best])) best = k;
    return best;
  }
}
