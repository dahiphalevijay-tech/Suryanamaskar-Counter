// The gradual daily plan: a target that climbs slowly toward the person's goal, eases back after a break,
// and suggests a lighter day after six days in a row. Pure functions; "days" is { 'YYYY-MM-DD': count }.

export const GOALS = [12, 24, 54, 108];
const MIN = 3;

function shift(key, n) {
  const [y, m, d] = key.split('-').map(Number);
  const x = new Date(y, m - 1, d + n);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}
const stepFor = (target) => (target < 12 ? 1 : target < 24 ? 2 : 3);

// Begins a plan from what the person has actually been doing lately (or from 3 a day with no history).
export function startPlan(goal, days, today) {
  const recent = Object.keys(days).filter((k) => k <= today && days[k] > 0).sort().slice(-3).map((k) => days[k]);
  const avg = recent.length ? Math.round(recent.reduce((a, b) => a + b, 0) / recent.length) : MIN;
  return { goal, target: Math.max(MIN, Math.min(goal, avg)), since: today, lastEval: today };
}

// Called when the app is opened: moves the target at most once per day.
export function evaluatePlan(state, days, today) {
  if (!state || state.lastEval === today) return state;
  const next = { ...state, lastEval: today };
  let met = 0;
  for (let k = state.since; k < today; k = shift(k, 1)) if ((days[k] || 0) >= state.target) met += 1;
  const idle = [1, 2, 3].every((n) => !(days[shift(today, -n)] > 0)) && state.since <= shift(today, -3);
  if (idle) { next.target = Math.max(MIN, state.target - stepFor(state.target)); next.since = today; }
  else if (met >= 2 && state.target < state.goal) { next.target = Math.min(state.goal, state.target + stepFor(state.target)); next.since = today; }
  return next;
}

// What to show for today.
export function todayPlan(state, days, today) {
  if (!state) return null;
  let run = 0;
  for (let k = shift(today, -1); days[k] > 0; k = shift(k, -1)) run += 1;
  const rest = run >= 6 && run % 7 === 6;
  const target = rest ? Math.ceil(state.target / 2) : state.target;
  const done = days[today] || 0;
  return { target, rest, done, remaining: Math.max(0, target - done), goal: state.goal };
}

// Splits a number of rounds into n sets as evenly as possible, e.g. 12 into 5 sets = 3, 3, 2, 2, 2.
export function splitSets(total, n) {
  const k = Math.max(1, Math.min(n, total));
  const base = Math.floor(total / k), extra = total % k;
  return Array.from({ length: k }, (_, i) => base + (i < extra ? 1 : 0));
}
