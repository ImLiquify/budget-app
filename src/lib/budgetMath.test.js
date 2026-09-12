import { describe, it, expect } from "vitest";
import { toLocalISODate, parseLocalDate, todayISO, daysBetween, addDays, FREQ_DAYS, computeNextAllowanceReminderDate, computeSnoozeDate, computeWeeklyUnderspend, bankUnderspend, applyWantPurchase, undoWantPurchase, isWantAffordable, isItemPurchasable, getActiveSlideIds, allowanceSlideMode, shouldBankUnderspend } from "./budgetMath.js";

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

describe("bankUnderspend", () => {
  it("adds needs underspend to savingsPool and wants underspend to wantsPool", () => {
    expect(bankUnderspend({ savingsPool: 10, wantsPool: 5 }, 20, 8)).toEqual({ savingsPool: 30, wantsPool: 13 });
  });
  it("treats missing pool values as zero", () => {
    expect(bankUnderspend({}, 15, 4)).toEqual({ savingsPool: 15, wantsPool: 4 });
  });
});

describe("applyWantPurchase", () => {
  it("subtracts the cost from the wants pool", () => {
    expect(applyWantPurchase(100, 40)).toBe(60);
  });
  it("floors at zero instead of going negative", () => {
    expect(applyWantPurchase(30, 40)).toBe(0);
  });
});

describe("undoWantPurchase", () => {
  it("adds the cost back to the wants pool", () => {
    expect(undoWantPurchase(60, 40)).toBe(100);
  });
});

describe("isWantAffordable", () => {
  it("is true when the pool covers the cost", () => {
    expect(isWantAffordable(500, 400)).toBe(true);
  });
  it("is false when the pool is short", () => {
    expect(isWantAffordable(100, 400)).toBe(false);
  });
});

describe("isItemPurchasable", () => {
  it("checks want-type items against the wants pool, not total balance", () => {
    expect(isItemPurchasable({ type: "want", cost: 400 }, 500, 100)).toBe(false);
  });
  it("says a want item is affordable once the wants pool covers it", () => {
    expect(isItemPurchasable({ type: "want", cost: 400 }, 500, 400)).toBe(true);
  });
  it("checks need-type items against total balance, unchanged", () => {
    expect(isItemPurchasable({ type: "need", cost: 400 }, 500, 0)).toBe(true);
    expect(isItemPurchasable({ type: "need", cost: 600 }, 500, 1000)).toBe(false);
  });
  it("also requires total balance to cover a want item, even if the pool alone would", () => {
    expect(isItemPurchasable({ type: "want", cost: 400 }, 300, 500)).toBe(false);
  });
});

describe("getActiveSlideIds", () => {
  const base = { checkInDue: false, nextAllowanceReminderDate: "2026-09-20", allowanceReminderSnoozed: false, todayIso: "2026-09-12" };

  it("only includes the quote slide when nothing is due or snoozed", () => {
    expect(getActiveSlideIds(base)).toEqual(["quote"]);
  });
  it("includes the check-in slide when check-in is due", () => {
    expect(getActiveSlideIds({ ...base, checkInDue: true })).toEqual(["quote", "checkin"]);
  });
  it("does not include the allowance slide before due, even without a snooze", () => {
    expect(getActiveSlideIds(base)).not.toContain("allowance");
  });
  it("includes the allowance slide once snoozed, before the due date", () => {
    expect(getActiveSlideIds({ ...base, allowanceReminderSnoozed: true })).toEqual(["quote", "allowance"]);
  });
  it("includes the allowance slide once actually due, regardless of the snooze flag", () => {
    expect(getActiveSlideIds({ ...base, todayIso: "2026-09-25" })).toEqual(["quote", "allowance"]);
  });
  it("includes all three slides when everything is active", () => {
    expect(getActiveSlideIds({ ...base, checkInDue: true, todayIso: "2026-09-25" })).toEqual(["quote", "checkin", "allowance"]);
  });
});

describe("allowanceSlideMode", () => {
  it("returns 'countdown' before the due date", () => {
    expect(allowanceSlideMode({ nextAllowanceReminderDate: "2026-09-20", todayIso: "2026-09-12" })).toBe("countdown");
  });
  it("returns 'due' on or after the due date", () => {
    expect(allowanceSlideMode({ nextAllowanceReminderDate: "2026-09-20", todayIso: "2026-09-20" })).toBe("due");
    expect(allowanceSlideMode({ nextAllowanceReminderDate: "2026-09-20", todayIso: "2026-09-25" })).toBe("due");
  });
});

describe("shouldBankUnderspend", () => {
  it("allows banking when never banked before", () => {
    expect(shouldBankUnderspend(null, "2026-09-12")).toBe(true);
  });
  it("blocks banking within 7 days of the last bank", () => {
    expect(shouldBankUnderspend("2026-09-10", "2026-09-12")).toBe(false);
  });
  it("allows banking again once 7 or more days have passed", () => {
    expect(shouldBankUnderspend("2026-09-05", "2026-09-12")).toBe(true);
  });
});
