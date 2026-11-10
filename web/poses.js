// The 12 poses of the traditional suryanamaskar, as side-view joint positions.
// Units are arbitrary; x grows in the facing direction, y is negative upward, ground is y = 0.
// "A" is the leg that stays forward in step 4, "B" the leg that goes back.
const P = (head, sh, el, wr, hip, knA, anA, knB, anB) => ({ head, sh, el, wr, hip, knA, anA, knB, anB });

const prayer = P([0, -72], [0, -62], [8, -52], [4, -58], [0, -36], [0, -18], [0, 0], [0, -18], [0, 0]);
const raised = P([-8, -70], [-3, -61], [-8, -73], [-14, -84], [3, -36], [1, -18], [0, 0], [1, -18], [0, 0]);
const bend = P([15, -6], [12, -14], [18, -8], [10, 0], [-2, -36], [0, -18], [0, 0], [0, -18], [0, 0]);
const lungeA = P([20, -37], [15, -28], [18, -14], [20, -1], [0, -15], [14, -18], [14, 0], [-16, -3], [-32, -1]);
const plank = P([29, -27], [20, -24], [20, -12], [20, 0], [-4, -17], [-21, -9], [-38, -2], [-21, -9], [-38, -2]);
const eight = P([25, -5], [16, -5], [10, -14], [16, -1], [-6, -14], [-20, -1], [-36, -1], [-20, -1], [-36, -1]);
const cobra = P([17, -34], [13, -24], [15, -12], [16, 0], [-4, -3], [-21, -2], [-38, -1], [-21, -2], [-38, -1]);
const mountain = P([12, -9], [17, -13], [22, -6], [27, 0], [0, -38], [-12, -19], [-22, 0], [-12, -19], [-22, 0]);
const lungeB = { ...lungeA, knA: lungeA.knB, anA: lungeA.anB, knB: lungeA.knA, anB: lungeA.anA };

export const POSES = [prayer, raised, bend, lungeA, plank, eight, cobra, mountain, lungeB, bend, raised, prayer];

export const POSE_INFO = [
  { sa: 'Pranamasana', dev: 'प्रणामासन', en: 'Prayer pose', breath: 'out' },
  { sa: 'Hasta Uttanasana', dev: 'हस्तउत्तानासन', en: 'Raised arms pose', breath: 'in' },
  { sa: 'Padahastasana', dev: 'पादहस्तासन', en: 'Forward bend', breath: 'out' },
  { sa: 'Ashwa Sanchalanasana', dev: 'अश्वसंचालनासन', en: 'Lunge', breath: 'in' },
  { sa: 'Dandasana', dev: 'दंडासन', en: 'Plank', breath: 'hold' },
  { sa: 'Ashtanga Namaskara', dev: 'अष्टांग नमस्कार', en: 'Eight-point salute', breath: 'out' },
  { sa: 'Bhujangasana', dev: 'भुजंगासन', en: 'Cobra', breath: 'in' },
  { sa: 'Parvatasana', dev: 'पर्वतासन', en: 'Mountain pose', breath: 'out' },
  { sa: 'Ashwa Sanchalanasana', dev: 'अश्वसंचालनासन', en: 'Lunge, other leg', breath: 'in' },
  { sa: 'Padahastasana', dev: 'पादहस्तासन', en: 'Forward bend', breath: 'out' },
  { sa: 'Hasta Uttanasana', dev: 'हस्तउत्तानासन', en: 'Raised arms pose', breath: 'in' },
  { sa: 'Pranamasana', dev: 'प्रणामासन', en: 'Prayer pose', breath: 'out' },
];

const ease = (t) => t * t * (3 - 2 * t);

export function lerpPose(a, b, t) {
  const e = ease(Math.min(1, Math.max(0, t)));
  const out = {};
  for (const k of Object.keys(a)) out[k] = [a[k][0] + (b[k][0] - a[k][0]) * e, a[k][1] + (b[k][1] - a[k][1]) * e];
  return out;
}

// Turns a joint set into the 33-point layout the pose detector produces (used by the tests).
export function toLandmarks(j, noise = 0, rnd = Math.random) {
  const pt = (p) => ({
    x: 0.5 + p[0] / 220 + (rnd() - 0.5) * noise,
    y: 0.88 + p[1] / 110 + (rnd() - 0.5) * noise,
    z: 0,
    visibility: 0.95,
  });
  const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0 }));
  lm[0] = pt(j.head);
  lm[11] = pt(j.sh); lm[12] = pt(j.sh);
  lm[13] = pt(j.el); lm[14] = pt(j.el);
  lm[15] = pt(j.wr); lm[16] = pt(j.wr);
  lm[23] = pt(j.hip); lm[24] = pt(j.hip);
  lm[25] = pt(j.knA); lm[26] = pt(j.knB);
  lm[27] = pt(j.anA); lm[28] = pt(j.anB);
  lm[29] = pt(j.anA); lm[30] = pt(j.anB);
  lm[31] = pt(j.anA); lm[32] = pt(j.anB);
  return lm;
}
