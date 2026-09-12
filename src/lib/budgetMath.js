export function toLocalISODate(d) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function parseLocalDate(iso) {
  if (iso instanceof Date) return iso;
  const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export const todayISO = () => toLocalISODate(new Date());

export const daysBetween = (a, b) => Math.ceil((parseLocalDate(b) - parseLocalDate(a)) / 86400000);

export function addDays(iso, days) {
  const d = parseLocalDate(iso);
  d.setDate(d.getDate() + days);
  return toLocalISODate(d);
}

export const FREQ_DAYS = {
  Daily: 1, Monthly: 30, Yearly: 365,
  daily: 1, monthly: 30, yearly: 365,
  day: 1, week: 7, month: 30, year: 365,
  Weekly: 7, weekly: 7
};

export function computeNextAllowanceReminderDate(fromIso, frequency) {
  return addDays(fromIso, FREQ_DAYS[frequency] || 30);
}

export function computeSnoozeDate({ fromIso, days, explicitDate }) {
  if (explicitDate) return explicitDate;
  return addDays(fromIso, days);
}

export function computeWeeklyUnderspend({ logs, dailyFlexNeeds, dailyWants, todayIso }) {
  let weeklyNeedsUnderspend = 0;
  let weeklyWantsUnderspend = 0;
  for (let i = 0; i < 7; i++) {
    const dayIso = addDays(todayIso, -i);
    const dayExpenses = logs.filter((l) => l.date === dayIso && l.type === "expense");
    const needsSpent = dayExpenses.filter((l) => l.category === "needs").reduce((s, l) => s + l.amount, 0);
    const wantsSpent = dayExpenses.filter((l) => l.category === "wants").reduce((s, l) => s + l.amount, 0);
    weeklyNeedsUnderspend += Math.max(0, dailyFlexNeeds - needsSpent);
    weeklyWantsUnderspend += Math.max(0, dailyWants - wantsSpent);
  }
  return { weeklyNeedsUnderspend, weeklyWantsUnderspend };
}
