// When more than one person is in the picture, stay with the one who is practising.
//
// Before counting starts (lock = false) the app looks for the person who is STANDING with the whole body in view,
// so friends sitting and watching are passed over, and it keeps to the same person once found.
// After calibration (lock = true) it stays with that person: someone appearing elsewhere in the picture is
// ignored instead of taken over, even when the practising person is briefly not detected.
//
// poses: list of landmark arrays from the detector.
// last: { x, y, size, t } for the person followed so far, or null.
// now: time in milliseconds (needed only when `last` is given).

const VIS = 0.3;
const ok = (p) => p && (p.visibility ?? 1) >= VIS;

function centre(lm) {
  const pts = [23, 24, 11, 12].map((i) => lm[i]).filter(ok);
  if (!pts.length) return null;
  return { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length };
}

function size(lm) {
  const vis = lm.filter(ok);
  if (vis.length < 4) return 0;
  const xs = vis.map((p) => p.x), ys = vis.map((p) => p.y);
  return Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
}

const avgY = (lm, ids) => {
  const pts = ids.map((i) => lm[i]).filter(ok);
  return pts.length ? pts.reduce((s, p) => s + p.y, 0) / pts.length : null;
};

// 1 for someone standing with head and feet in view, less for someone sitting, crouching or cut off.
export function standingScore(lm) {
  const sh = avgY(lm, [11, 12]), hip = avgY(lm, [23, 24]), knee = avgY(lm, [25, 26]), ank = avgY(lm, [27, 28]);
  if (sh === null || hip === null || ank === null) return 0.3;       // feet or body out of the picture
  const body = ank - sh;
  if (body <= 0) return 0.3;
  const legs = (ank - hip) / body;                                   // standing about 0.55, sitting about 0.3 or less
  const thigh = knee === null ? 0.25 : (knee - hip) / body;           // sitting: knees level with the hips
  return legs > 0.42 && thigh > 0.12 ? 1 : 0.4;
}

export function pickPerson(poses, memory, now = 0, lock = false) {
  if (!poses || !poses.length) return { lm: null, centre: memory };
  // memory may hold only the other people seen (after the person practising was out of view for a while)
  const last = memory && Number.isFinite(memory.x) ? memory : null;
  const cands = [];
  for (const lm of poses) {
    const c = centre(lm);
    if (c) cands.push({ lm, c, s: size(lm) });
  }
  if (!cands.length) return { lm: null, centre: memory };
  const dist = (k) => (last ? Math.hypot(k.c.x - last.x, k.c.y - last.y) : 0);
  // Other people seen recently, and where. Friends watching mostly stay put, so a pose found where one of them
  // has been sitting is taken to be that friend, even while the person practising is briefly not detected.
  const others = ((memory && memory.others) || []).filter((o) => now - o.t < 10000);
  const known = (k) => others.some((o) => Math.hypot(k.c.x - o.x, k.c.y - o.y) < 0.08);
  const keep = (best, lm) => {
    // others are noted only while our person is seen elsewhere in the same picture, so they are never mixed up
    const seen = best ? cands.filter((k) => k !== best && Math.hypot(k.c.x - best.c.x, k.c.y - best.c.y) > 0.15)
      .map((k) => ({ x: k.c.x, y: k.c.y, t: now })) : [];
    const old = others.filter((o) => !seen.some((n) => Math.hypot(n.x - o.x, n.y - o.y) < 0.08));
    const all = [...seen, ...old].slice(0, 6);
    if (!best) return { lm: null, centre: { ...(last || {}), others: all } };
    return { lm, centre: { x: best.c.x, y: best.c.y, size: best.s, t: now, others: all } };
  };
  let best;
  if (lock && last) {
    // How far the body centre can move since it was last seen: a little per frame, a bit more after a gap.
    const gap = Math.max(0, now - (last.t ?? now));
    const allowed = Math.max(0.12, (last.size || 0.5) * 0.35) + 0.15 * Math.min(1, gap / 2000);
    for (const k of cands) if (dist(k) <= allowed && !known(k) && (!best || dist(k) < dist(best))) best = k;
    return keep(best, best && best.lm);                              // nobody near: wait for our person
  }
  // Before counting starts: prefer someone standing in full view, then the biggest; stick with the person
  // already chosen unless someone else is clearly the better choice.
  const score = (k) => {
    const st = standingScore(k.lm);
    if (known(k) && st < 1) return 0;                                // a friend known to be sitting there
    return k.s * st * (last && dist(k) < 0.15 ? 1.3 : 1) * (known(k) ? 0.5 : 1);
  };
  for (const k of cands) if (!best || score(k) > score(best)) best = k;
  if (score(best) === 0) return keep(null);
  // the person just followed was missed for a moment: don't hop to someone sitting elsewhere meanwhile
  if (last && now - (last.t ?? now) < 1000 && dist(best) > 0.15 && standingScore(best.lm) < 1) return keep(null);
  return keep(best, best.lm);
}
