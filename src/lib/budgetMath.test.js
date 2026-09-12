import { describe, it, expect } from "vitest";
import { toLocalISODate, parseLocalDate, todayISO, daysBetween, addDays, FREQ_DAYS } from "./budgetMath.js";

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
