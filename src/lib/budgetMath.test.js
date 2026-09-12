import { describe, it, expect } from "vitest";
import { toLocalISODate, parseLocalDate, todayISO, daysBetween, addDays, FREQ_DAYS, computeNextAllowanceReminderDate, computeSnoozeDate, computeWeeklyUnderspend } from "./budgetMath.js";

describe("toLocalISODate", () => {
  it("formats a Date as YYYY-MM-DD using local fields", () => {
    expect(toLocalISODate(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});

describe("parseLocalDate", () => {
  it("parses an ISO date string into a local Date at midnight", () => {
    const d = parseLocalDate("2026-03-10");
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(2);
    expect(d.getDate()).toBe(10);
  });
});

describe("todayISO", () => {
  it("returns today's date in YYYY-MM-DD form", () => {
    expect(todayISO()).toBe(toLocalISODate(new Date()));
  });
});

describe("daysBetween", () => {
  it("returns the number of days from a to b", () => {
    expect(daysBetween("2026-01-01", "2026-01-08")).toBe(7);
  });
  it("returns a negative number when b is before a", () => {
    expect(daysBetween("2026-01-08", "2026-01-01")).toBe(-7);
  });
});

describe("addDays", () => {
  it("adds days to an ISO date string", () => {
    expect(addDays("2026-01-25", 10)).toBe("2026-02-04");
  });
  it("subtracts days when given a negative value", () => {
    expect(addDays("2026-01-05", -10)).toBe("2025-12-26");
  });
});

describe("FREQ_DAYS", () => {
  it("maps every allowance frequency to a day count", () => {
    expect(FREQ_DAYS.Monthly).toBe(30);
    expect(FREQ_DAYS.Weekly).toBe(7);
    expect(FREQ_DAYS.Daily).toBe(1);
    expect(FREQ_DAYS.Yearly).toBe(365);
  });
});

describe("computeNextAllowanceReminderDate", () => {
  it("adds the frequency's day count to the given date", () => {
    expect(computeNextAllowanceReminderDate("2026-09-05", "Monthly")).toBe(addDays("2026-09-05", 30));
    expect(computeNextAllowanceReminderDate("2026-09-05", "Weekly")).toBe(addDays("2026-09-05", 7));
    expect(computeNextAllowanceReminderDate("2026-09-05", "Daily")).toBe(addDays("2026-09-05", 1));
    expect(computeNextAllowanceReminderDate("2026-09-05", "Yearly")).toBe(addDays("2026-09-05", 365));
  });
  it("falls back to 30 days for an unrecognized frequency", () => {
    expect(computeNextAllowanceReminderDate("2026-09-05", "Bogus")).toBe(addDays("2026-09-05", 30));
  });
});

describe("computeSnoozeDate", () => {
  it("adds the preset day offset when no explicit date is given", () => {
    expect(computeSnoozeDate({ fromIso: "2026-09-12", days: 7, explicitDate: null })).toBe("2026-09-19");
  });
  it("uses the explicit date when provided, ignoring days", () => {
    expect(computeSnoozeDate({ fromIso: "2026-09-12", days: 7, explicitDate: "2026-10-01" })).toBe("2026-10-01");
  });
});

describe("computeWeeklyUnderspend", () => {
  it("sums zero underspend when every day is spent exactly to cap", () => {
    const todayIso = "2026-09-12";
    const logs = [];
    for (let i = 0; i < 7; i++) {
      const date = addDays(todayIso, -i);
      logs.push({ date, type: "expense", category: "needs", amount: 20 });
      logs.push({ date, type: "expense", category: "wants", amount: 10 });
    }
    const result = computeWeeklyUnderspend({ logs, dailyFlexNeeds: 20, dailyWants: 10, todayIso });
    expect(result).toEqual({ weeklyNeedsUnderspend: 0, weeklyWantsUnderspend: 0 });
  });

  it("banks the full cap on days with zero spend", () => {
    const todayIso = "2026-09-12";
    const result = computeWeeklyUnderspend({ logs: [], dailyFlexNeeds: 20, dailyWants: 10, todayIso });
    expect(result).toEqual({ weeklyNeedsUnderspend: 140, weeklyWantsUnderspend: 70 });
  });

  it("does not go negative on days that overspent the cap", () => {
    const todayIso = "2026-09-12";
    const logs = [{ date: todayIso, type: "expense", category: "needs", amount: 50 }];
    const result = computeWeeklyUnderspend({ logs, dailyFlexNeeds: 20, dailyWants: 10, todayIso });
    expect(result).toEqual({ weeklyNeedsUnderspend: 120, weeklyWantsUnderspend: 70 });
  });

  it("ignores income logs and logs outside the 7-day window", () => {
    const todayIso = "2026-09-12";
    const logs = [
      { date: todayIso, type: "income", category: "needs", amount: 1000 },
      { date: addDays(todayIso, -10), type: "expense", category: "needs", amount: 20 },
    ];
    const result = computeWeeklyUnderspend({ logs, dailyFlexNeeds: 20, dailyWants: 10, todayIso });
    expect(result).toEqual({ weeklyNeedsUnderspend: 140, weeklyWantsUnderspend: 70 });
  });
});
