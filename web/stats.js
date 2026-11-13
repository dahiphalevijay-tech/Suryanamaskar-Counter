// Numbers for the Progress screen: calorie estimate and weekly / monthly insights.

export const dayKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Energy cost of suryanamaskar rises with pace. Published measurements run from about 3.3 MET for a slow
// sequence to about 7.4 MET for a brisk one, so the estimate slides between those with rounds per minute.
// (1 MET = 1 kcal per kg of body weight per hour.) This is an estimate, not a measurement.
export function metForPace(secPerRound) {
  if (!secPerRound || secPerRound <= 0) return 4;
  const perMin = 60 / secPerRound;
  return Math.min(7.4, Math.max(3.3, 3.3 + (perMin - 1) * (4.1 / 3)));
}

export function kcalFor(weightKg, activeMs, rounds) {
  if (!weightKg || !activeMs || !rounds) return 0;
  return metForPace(activeMs / 1000 / rounds) * weightKg * (activeMs / 3600000);
}

export function bmi(weightKg, heightCm) {
  if (!weightKg || !heightCm) return 0;
  const m = heightCm / 100;
  return weightKg / (m * m);
}

// days: { 'YYYY-MM-DD': count }.  sessions: [{ t, n, ms, rounds, rej, steps[12], kcal }].
export function summarize(days, sessions, periodDays, now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (periodDays - 1));
  const prevStart = new Date(start.getFullYear(), start.getMonth(), start.getDate() - periodDays);
  const bars = [];
  let total = 0, practised = 0, best = null;
  for (let i = 0; i < periodDays; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const count = days[dayKey(d)] || 0;
    bars.push({ date: d, count });
    total += count;
    if (count > 0) practised += 1;
    if (count > 0 && (!best || count > best.count)) best = { date: d, count };
  }
  let prev = 0;
  for (let i = 0; i < periodDays; i++) {
    const d = new Date(prevStart.getFullYear(), prevStart.getMonth(), prevStart.getDate() + i);
    prev += days[dayKey(d)] || 0;
  }

  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const mine = sessions.filter((s) => s.t >= start.getTime() && s.t < end.getTime());
  let ms = 0, rounds = 0, kcal = 0;
  const hours = new Array(24).fill(0);
  const seen = new Array(12).fill(0);
  for (const s of mine) {
    ms += s.ms || 0;
    rounds += s.rounds || 0;
    kcal += s.kcal || 0;
    if (s.n > 0) hours[new Date(s.t).getHours()] += 1;
    (s.steps || []).forEach((v, i) => { seen[i] += v; });
  }
  let usualHour = null;
  if (mine.some((s) => s.n > 0)) usualHour = hours.indexOf(Math.max(...hours));
  let missed = null;
  if (rounds > 0) {
    // steps 1 and 12 are always recognised, so only the ten in between can be missed
    for (let i = 1; i <= 10; i++) {
      const m = rounds - seen[i];
      if (m > 0 && (!missed || m > missed.missed)) missed = { step: i + 1, missed: m, rounds };
    }
  }
  return {
    bars, total, prev, practised, best,
    paceSec: rounds > 0 ? ms / 1000 / rounds : 0,
    activeMs: ms, rounds, kcal, usualHour, missed, hasDetail: mine.length > 0,
  };
}

// Calories recorded in sessions since the start of the day `daysBack` days ago (0 = today only).
export function kcalSince(sessions, daysBack, now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysBack).getTime();
  return sessions.filter((s) => s.t >= start).reduce((a, s) => a + (s.kcal || 0), 0);
}

// Combines saved progress from a file with what is on the phone. Nothing is lost from either side:
// each day keeps its higher count, and sessions are joined without duplicates. Returns null for a foreign file.
export function mergeProgress(current, incoming) {
  if (!incoming || incoming.app !== 'suryanamaskar' || typeof incoming.days !== 'object' || incoming.days === null) return null;
  const days = { ...current.days };
  for (const [k, v] of Object.entries(incoming.days)) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(k) && Number.isFinite(v) && v >= 0) days[k] = Math.max(days[k] || 0, Math.floor(v));
  }
  const byTime = new Map();
  for (const s of [...(current.sessions || []), ...(Array.isArray(incoming.sessions) ? incoming.sessions : [])]) {
    if (s && Number.isFinite(s.t) && Number.isFinite(s.n)) byTime.set(s.t, s);
  }
  return { days, sessions: [...byTime.values()].sort((a, b) => a.t - b.t).slice(-3000) };
}
