// When more than one person is in the picture, stay with the one who is practising.
// poses: list of landmark arrays from the detector. last: {x, y} centre of the person followed so far, or null.

function centre(lm) {
  const pts = [23, 24, 11, 12].map((i) => lm[i]).filter((p) => p && (p.visibility ?? 1) >= 0.3);
  if (!pts.length) return null;
  return { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length };
}

function size(lm) {
  const vis = lm.filter((p) => p && (p.visibility ?? 1) >= 0.3);
  if (vis.length < 4) return 0;
  const xs = vis.map((p) => p.x), ys = vis.map((p) => p.y);
  return Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
}

export function pickPerson(poses, last) {
  if (!poses || !poses.length) return { lm: null, centre: last };
  let best = null;
  for (const lm of poses) {
    const c = centre(lm);
    if (!c) continue;
    // with someone already being followed, the nearest pose wins; otherwise the biggest person does
    const score = last ? -Math.hypot(c.x - last.x, c.y - last.y) : size(lm);
    if (!best || score > best.score) best = { lm, c, score };
  }
  if (!best) return { lm: poses[0], centre: last };
  return { lm: best.lm, centre: best.c };
}
