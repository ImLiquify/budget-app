# Allowance Reminder, Weekly Learning & Wishlist Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a recurring allowance re-input reminder, make the weekly Strategy check-in bank under-spent days into visible Savings/Wants pools instead of inflating tomorrow's cap, fix wishlist "want" affordability to check against the Wants pool instead of total balance, and replace the Dashboard's separate due-banners with one auto-rotating carousel banner.

**Architecture:** Extract the new pure calculation logic (date math, weekly under-spend summation, pool arithmetic, carousel slide-activation) into a new framework-free module, `src/lib/budgetMath.js`, alongside the six existing date/frequency utilities moved out of `src/App.jsx` for the same reason: they're the only pieces of this single-file React app that can be unit tested without a DOM. Everything else — new components, state wiring, persistence — follows the existing patterns already used throughout `App.jsx` (local `useState`, a `persist()` call after every mutation, modals built from the shared `Modal`/`Card`/`Btn`/`Field` components).

**Tech Stack:** React 18, Vite 5, Tailwind (CDN), Vitest (new, for `src/lib/budgetMath.js` only).

**Spec:** [docs/superpowers/specs/2026-09-12-budget-reminder-and-learning-design.md](../specs/2026-09-12-budget-reminder-and-learning-design.md)

## Global Constraints

- No backend, no push notifications, no service worker changes — everything stays client-side/localStorage, per the spec's "Out of scope" section.
- Vitest covers only the new pure functions in `src/lib/budgetMath.js`; React components remain manually verified in the browser (no React Testing Library, no component tests) — per the spec's Testing section.
- Every pool value (`savingsPool`, `wantsPool`) is floored at 0 on every mutation — never allowed to go negative.
- Exact UI copy for the three reminder actions: "Set amount", "Leave the same", "Remind me again" (per spec Flow 1). Carousel action buttons: "Check in now", "Input now" (per spec Flow 4).
- `profile.savingsPool` / `profile.wantsPool` / `profile.allowanceReminderSnoozed` / `profile.nextAllowanceReminderDate` must always read safely via `|| 0` / `?? false` style defaults, matching the existing codebase's defensive-read style (e.g. `Number(profile.totalReceived) || 0`).
- Follow existing component patterns exactly: `Modal`, `Card`, `Btn`, `Field`, `TextInput`, `Select`, `PillToggle`, `Stat`, `Banner` are all already defined in `App.jsx` and must be reused, not reimplemented.

---

## File Structure

- **Create** `src/lib/budgetMath.js` — every pure function this change needs: the six existing date/frequency utilities (moved, unchanged bodies) plus all new calculation logic (reminder dates, weekly under-spend, pool arithmetic, affordability, carousel slide activation). Zero React/JSX, zero DOM — this is what makes it unit-testable.
- **Create** `src/lib/budgetMath.test.js` — Vitest tests for every function above, colocated per Vitest convention.
- **Modify** `src/App.jsx` — remove the six moved functions/constant, import them back from `./lib/budgetMath.js`, and wire in the four flows: new state (`showAllowanceReminderModal`), new functions (`snoozeAllowanceReminder`, `changeFrequency`), extended functions (`submitAllowance`, `markPurchased`, `undoPurchase`, `applyRecommendedSplit`), new components (`AllowanceReminderModal`, `DashboardCarouselBanner`), and edits to existing components (`Dashboard`, `Strategy`, `WishlistModal`, `TargetItemCard`, `MacroCheckInModal`, `ProfilePage`, `Onboarding`).
- **Modify** `package.json` — add `vitest` as a dev dependency and a `test` script.
- **Modify** `vite.config.js` — add a `test` config block so Vitest picks up the same config Vite uses.

---

### Task 1: Install dependencies, add Vitest, extract date/frequency utilities into `src/lib/budgetMath.js`

**Files:**
- Modify: `package.json`
- Modify: `vite.config.js`
- Create: `src/lib/budgetMath.js`
- Create: `src/lib/budgetMath.test.js`
- Modify: `src/App.jsx:1-11` (imports), `src/App.jsx:57-62` (`FREQ_DAYS`), `src/App.jsx:110-140` (date helpers)

**Interfaces:**
- Produces (used by every later task): `toLocalISODate(date)`, `parseLocalDate(iso)`, `todayISO()`, `daysBetween(a, b)`, `addDays(iso, days)`, `FREQ_DAYS` (object keyed by frequency string → day count), all exported from `src/lib/budgetMath.js`.

- [ ] **Step 1: Install existing dependencies (this repo has never had `npm install` run)**

Run: `npm install`
Expected: installs `react`, `vite`, etc. with no errors; creates `node_modules/`.

- [ ] **Step 2: Install Vitest**

Run: `npm install -D vitest`
Expected: `vitest` added to `package.json`'s `devDependencies`.

- [ ] **Step 3: Add the `test` script to `package.json`**

In `package.json`, inside `"scripts"`, add:

```json
"test": "vitest run"
```

- [ ] **Step 4: Add a `test` block to `vite.config.js`**

```js
export default defineConfig({
    base: '/budget-app/',
    test: {
        environment: 'node',
    },
    plugins: [
        react(),
        VitePWA({
```

(Insert the `test` block right after `base: '/budget-app/',` and before `plugins: [`, leaving everything else in the file unchanged.)

- [ ] **Step 5: Create `src/lib/budgetMath.js` with the moved utilities**

```js
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
```

- [ ] **Step 6: Write `src/lib/budgetMath.test.js` covering the moved utilities**

```js
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
```

- [ ] **Step 7: Run the tests, verify they pass**

Run: `npm test`
Expected: all tests in `budgetMath.test.js` PASS.

- [ ] **Step 8: Remove the moved code from `src/App.jsx` and import it instead**

Delete the `FREQ_DAYS` constant currently at `App.jsx:57-62`.

Delete these five function/const definitions currently at `App.jsx:110-140`: `toLocalISODate`, `parseLocalDate`, `todayISO`, `daysBetween`, `addDays` (leave `symbolFor`, `fmt`, `nextWeekday` where they are — they aren't moving).

Add this import right after the existing `recharts` import block (after `App.jsx:11`):

```js
import {
  toLocalISODate, parseLocalDate, todayISO, daysBetween, addDays, FREQ_DAYS,
} from "./lib/budgetMath.js";
```

- [ ] **Step 9: Verify the app still builds**

Run: `npm run build`
Expected: build succeeds with no errors (confirms nothing still references the deleted local definitions incorrectly).

- [ ] **Step 10: Commit**

```bash
git add package.json vite.config.js src/lib/budgetMath.js src/lib/budgetMath.test.js src/App.jsx
git commit -m "$(cat <<'EOF'
Extract date/frequency utilities into src/lib/budgetMath.js, add Vitest

Moves toLocalISODate/parseLocalDate/todayISO/daysBetween/addDays/
FREQ_DAYS out of App.jsx into a framework-free module so the new
budgeting logic (reminder dates, weekly under-spend, pool arithmetic)
can be unit tested without a DOM.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Allowance reminder date math (`computeNextAllowanceReminderDate`, `computeSnoozeDate`)

**Files:**
- Modify: `src/lib/budgetMath.js`
- Modify: `src/lib/budgetMath.test.js`

**Interfaces:**
- Consumes: `addDays(iso, days)`, `FREQ_DAYS` (Task 1).
- Produces: `computeNextAllowanceReminderDate(fromIso, frequency)` → ISO date string. `computeSnoozeDate({ fromIso, days, explicitDate })` → ISO date string.

- [ ] **Step 1: Add the failing tests to `src/lib/budgetMath.test.js`**

```js
import { computeNextAllowanceReminderDate, computeSnoozeDate } from "./budgetMath.js";

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
```

(Add the new `import` names to the existing `import ... from "./budgetMath.js"` line at the top of the file rather than duplicating the import statement.)

- [ ] **Step 2: Run tests, verify they fail**

Run: `npm test`
Expected: FAIL — `computeNextAllowanceReminderDate is not a function` (or similar).

- [ ] **Step 3: Implement in `src/lib/budgetMath.js`**

```js
export function computeNextAllowanceReminderDate(fromIso, frequency) {
  return addDays(fromIso, FREQ_DAYS[frequency] || 30);
}

export function computeSnoozeDate({ fromIso, days, explicitDate }) {
  if (explicitDate) return explicitDate;
  return addDays(fromIso, days);
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `npm test`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/budgetMath.js src/lib/budgetMath.test.js
git commit -m "$(cat <<'EOF'
Add allowance reminder date math to budgetMath

computeNextAllowanceReminderDate and computeSnoozeDate back Flow 1's
recurring re-input reminder.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Weekly under-spend summation (`computeWeeklyUnderspend`)

**Files:**
- Modify: `src/lib/budgetMath.js`
- Modify: `src/lib/budgetMath.test.js`

**Interfaces:**
- Consumes: `addDays(iso, days)` (Task 1).
- Produces: `computeWeeklyUnderspend({ logs, dailyFlexNeeds, dailyWants, todayIso })` → `{ weeklyNeedsUnderspend, weeklyWantsUnderspend }`. `logs` is the app's existing log array shape: `{ date: "YYYY-MM-DD", type: "expense"|"income", category: "needs"|"wants"|"income", amount: number }`.

- [ ] **Step 1: Add the failing tests**

```js
import { computeWeeklyUnderspend } from "./budgetMath.js";

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
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npm test`
Expected: FAIL — `computeWeeklyUnderspend is not a function`.

- [ ] **Step 3: Implement**

```js
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
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `npm test`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/budgetMath.js src/lib/budgetMath.test.js
git commit -m "$(cat <<'EOF'
Add computeWeeklyUnderspend to budgetMath

Sums each of the last 7 days' unused Needs-flex and Wants budget,
floored at zero per day, for Flow 2's weekly check-in banking.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Pool arithmetic (`bankUnderspend`, `applyWantPurchase`, `undoWantPurchase`, `isWantAffordable`, `isItemPurchasable`)

**Files:**
- Modify: `src/lib/budgetMath.js`
- Modify: `src/lib/budgetMath.test.js`

**Interfaces:**
- Produces: `bankUnderspend(pools, weeklyNeedsUnderspend, weeklyWantsUnderspend)` → `{ savingsPool, wantsPool }`. `applyWantPurchase(wantsPool, cost)` → number. `undoWantPurchase(wantsPool, cost)` → number. `isWantAffordable(wantsPool, cost)` → boolean. `isItemPurchasable(item, balance, wantsPool)` → boolean, where `item` is `{ type: "need"|"want", cost: number, ... }`.

- [ ] **Step 1: Add the failing tests**

```js
import { bankUnderspend, applyWantPurchase, undoWantPurchase, isWantAffordable, isItemPurchasable } from "./budgetMath.js";

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
});
```

(The `isItemPurchasable` "want-type" tests directly encode the user's original example: RM500 balance, RM400 item, only RM100 in the wants pool — must be `false`.)

- [ ] **Step 2: Run tests, verify they fail**

Run: `npm test`
Expected: FAIL — functions not defined.

- [ ] **Step 3: Implement**

```js
export function bankUnderspend(pools, weeklyNeedsUnderspend, weeklyWantsUnderspend) {
  return {
    savingsPool: Math.max(0, (pools.savingsPool || 0) + weeklyNeedsUnderspend),
    wantsPool: Math.max(0, (pools.wantsPool || 0) + weeklyWantsUnderspend),
  };
}

export function applyWantPurchase(wantsPool, cost) {
  return Math.max(0, (wantsPool || 0) - cost);
}

export function undoWantPurchase(wantsPool, cost) {
  return (wantsPool || 0) + cost;
}

export function isWantAffordable(wantsPool, cost) {
  return (wantsPool || 0) >= cost;
}

export function isItemPurchasable(item, balance, wantsPool) {
  return item.type === "want" ? isWantAffordable(wantsPool, item.cost) : balance >= item.cost;
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `npm test`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/budgetMath.js src/lib/budgetMath.test.js
git commit -m "$(cat <<'EOF'
Add pool arithmetic and wishlist affordability helpers to budgetMath

bankUnderspend/applyWantPurchase/undoWantPurchase/isWantAffordable back
Flow 2's pools; isItemPurchasable is Flow 3's fix so "want" items check
against the Wants pool instead of total cash balance.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Carousel slide-activation logic (`getActiveSlideIds`, `allowanceSlideMode`)

**Files:**
- Modify: `src/lib/budgetMath.js`
- Modify: `src/lib/budgetMath.test.js`

**Interfaces:**
- Produces: `allowanceSlideMode({ nextAllowanceReminderDate, todayIso })` → `"due" | "countdown"`. `getActiveSlideIds({ checkInDue, nextAllowanceReminderDate, allowanceReminderSnoozed, todayIso })` → array, a subset (in a fixed order) of `["quote", "checkin", "allowance"]`; `"quote"` is always present.

- [ ] **Step 1: Add the failing tests**

```js
import { getActiveSlideIds, allowanceSlideMode } from "./budgetMath.js";

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
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npm test`
Expected: FAIL — functions not defined.

- [ ] **Step 3: Implement**

```js
export function allowanceSlideMode({ nextAllowanceReminderDate, todayIso }) {
  return todayIso >= nextAllowanceReminderDate ? "due" : "countdown";
}

export function getActiveSlideIds({ checkInDue, nextAllowanceReminderDate, allowanceReminderSnoozed, todayIso }) {
  const slides = ["quote"];
  if (checkInDue) slides.push("checkin");
  const mode = allowanceSlideMode({ nextAllowanceReminderDate, todayIso });
  if (mode === "due" || allowanceReminderSnoozed) slides.push("allowance");
  return slides;
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `npm test`
Expected: all PASS. This also completes `src/lib/budgetMath.js` — run `npm test` once more standalone to confirm the whole file's suite (all 5 tasks' tests) is green before moving into `App.jsx` wiring.

- [ ] **Step 5: Commit**

```bash
git add src/lib/budgetMath.js src/lib/budgetMath.test.js
git commit -m "$(cat <<'EOF'
Add carousel slide-activation logic to budgetMath

getActiveSlideIds/allowanceSlideMode decide which of quote/checkin/
allowance slides Flow 4's Dashboard carousel shows and whether the
allowance slide reads as a due-now prompt or a snoozed countdown.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Data model — patch new profile fields on load and on onboarding

**Files:**
- Modify: `src/App.jsx:1-11` (import list), `src/App.jsx:746-756` (`Onboarding`'s `finish`), `src/App.jsx:1717-1750` (load `useEffect`)

**Interfaces:**
- Consumes: `computeNextAllowanceReminderDate(fromIso, frequency)` (Task 2), `todayISO()` (Task 1).
- Produces: every `profile` object from this point on carries `savingsPool` (number), `wantsPool` (number), `allowanceReminderSnoozed` (boolean), `nextAllowanceReminderDate` (ISO date string) — relied on by Tasks 7–12.

- [ ] **Step 1: Add `computeNextAllowanceReminderDate` to the `budgetMath.js` import in `App.jsx`**

Update the import added in Task 1, Step 8, to also pull in `computeNextAllowanceReminderDate`:

```js
import {
  toLocalISODate, parseLocalDate, todayISO, daysBetween, addDays, FREQ_DAYS,
  computeNextAllowanceReminderDate,
} from "./lib/budgetMath.js";
```

- [ ] **Step 2: Initialize the new fields in `Onboarding`'s `finish()` (`App.jsx:746-756`)**

Find:

```js
  const finish = () => {
    const today = todayISO();
    onComplete({
      profile: {
        name: name.trim() || "You", currency, frequency, allowance: Number(allowance) || 0,
        lastAllowanceUpdate: today, memberSince: today, totalReceived: Number(allowance) || 0,
        checkInDay: 1, nextCheckInDate: nextWeekday(today, 1), isGoogleConnected: false,
      },
      items, expenses, budgetSplit: split, suggestedSplit: suggested,
    });
  };
```

Replace with:

```js
  const finish = () => {
    const today = todayISO();
    onComplete({
      profile: {
        name: name.trim() || "You", currency, frequency, allowance: Number(allowance) || 0,
        lastAllowanceUpdate: today, memberSince: today, totalReceived: Number(allowance) || 0,
        checkInDay: 1, nextCheckInDate: nextWeekday(today, 1), isGoogleConnected: false,
        savingsPool: 0, wantsPool: 0, allowanceReminderSnoozed: false,
        nextAllowanceReminderDate: computeNextAllowanceReminderDate(today, frequency),
      },
      items, expenses, budgetSplit: split, suggestedSplit: suggested,
    });
  };
```

- [ ] **Step 3: Patch the new fields onto existing saved profiles on load (`App.jsx:1717-1750`)**

Find the `patched` object inside the load `useEffect`:

```js
            const patched = {
              totalReceived: p.totalReceived ?? p.allowance ?? 0,
              checkInDay: p.checkInDay ?? 1,
              nextCheckInDate: p.nextCheckInDate ?? nextWeekday(today, p.checkInDay ?? 1),
              tier: p.tier || "free",
              isGoogleConnected: p.isGoogleConnected || false,
              remindersEnabled: p.remindersEnabled ?? true,
            };
```

Replace with:

```js
            const patched = {
              totalReceived: p.totalReceived ?? p.allowance ?? 0,
              checkInDay: p.checkInDay ?? 1,
              nextCheckInDate: p.nextCheckInDate ?? nextWeekday(today, p.checkInDay ?? 1),
              tier: p.tier || "free",
              isGoogleConnected: p.isGoogleConnected || false,
              remindersEnabled: p.remindersEnabled ?? true,
              savingsPool: p.savingsPool ?? 0,
              wantsPool: p.wantsPool ?? 0,
              allowanceReminderSnoozed: p.allowanceReminderSnoozed ?? false,
              nextAllowanceReminderDate: p.nextAllowanceReminderDate
                ?? computeNextAllowanceReminderDate(p.lastAllowanceUpdate || today, p.frequency),
            };
```

- [ ] **Step 4: Verify the app builds and boots**

Run: `npm run build`
Expected: build succeeds.

Run: `npm run dev`, open the app in a browser. If you have no existing saved profile, complete onboarding and confirm no console errors. If you have an existing saved profile from an earlier manual test, reload the page and confirm no console errors (open DevTools console).

- [ ] **Step 5: Commit**

```bash
git add src/App.jsx
git commit -m "$(cat <<'EOF'
Initialize savingsPool/wantsPool/allowanceReminderSnoozed/
nextAllowanceReminderDate on the profile

Sets these on fresh onboarding completion and patches them onto
existing saved profiles on load, so every profile has valid values
before Flow 1/2/3/4 read them.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: `submitAllowance` extension, `snoozeAllowanceReminder`, `changeFrequency`

**Files:**
- Modify: `src/App.jsx:1575-1701` (`ProfilePage`), `src/App.jsx:1850-1860` (`submitAllowance`), and the `App()` function body around it (new functions + call site prop wiring).

**Interfaces:**
- Consumes: `computeNextAllowanceReminderDate` (Task 2, already imported in Task 6).
- Produces: `submitAllowance({ amount, currency })` now also resets `nextAllowanceReminderDate` and `allowanceReminderSnoozed`. New `snoozeAllowanceReminder(newDate)`. New `changeFrequency(freq)`. `ProfilePage` gains an `onChangeFrequency` prop. These are consumed by Task 8 (reminder modal) and Task 10 (carousel).

- [ ] **Step 1: Extend `submitAllowance` (`App.jsx:1850-1860`)**

Find:

```js
  function submitAllowance({ amount, currency }) {
    const next = {
      ...profile, allowance: amount, currency,
      lastAllowanceUpdate: todayISO(),
      totalReceived: (Number(profile.totalReceived) || 0) + amount,
      dailyCapOverride: null,
      dailyNeedsCap: null,
      dailyWantsCap: null,
    };
    setProfile(next); persist({ profile: next });
  }
```

Replace with:

```js
  function submitAllowance({ amount, currency }) {
    const next = {
      ...profile, allowance: amount, currency,
      lastAllowanceUpdate: todayISO(),
      totalReceived: (Number(profile.totalReceived) || 0) + amount,
      dailyCapOverride: null,
      dailyNeedsCap: null,
      dailyWantsCap: null,
      nextAllowanceReminderDate: computeNextAllowanceReminderDate(todayISO(), profile.frequency),
      allowanceReminderSnoozed: false,
    };
    setProfile(next); persist({ profile: next });
  }

  function snoozeAllowanceReminder(newDate) {
    const next = { ...profile, nextAllowanceReminderDate: newDate, allowanceReminderSnoozed: true };
    setProfile(next); persist({ profile: next });
  }

  function changeFrequency(freq) {
    const next = {
      ...profile,
      frequency: freq,
      nextAllowanceReminderDate: computeNextAllowanceReminderDate(profile.lastAllowanceUpdate || todayISO(), freq),
    };
    setProfile(next); persist({ profile: next });
  }
```

- [ ] **Step 2: Wire `changeFrequency` into `ProfilePage`**

Find `ProfilePage`'s function signature (`App.jsx:1575`):

```js
function ProfilePage({ state, symbol, onUpdateProfile, onAddItem, onDeleteItem, onAddExpense, onDeleteExpense, onReset, onToggleNotif, onOpenAllowanceModal, onGoogleSignInSuccess, onGoogleSignOut }) {
```

Replace with:

```js
function ProfilePage({ state, symbol, onUpdateProfile, onAddItem, onDeleteItem, onAddExpense, onDeleteExpense, onReset, onToggleNotif, onOpenAllowanceModal, onGoogleSignInSuccess, onGoogleSignOut, onChangeFrequency }) {
```

Find the Frequency field inside `ProfilePage`:

```js
          <Field label="Frequency">
            <Select value={profile.frequency} onChange={(e) => onUpdateProfile({ frequency: e.target.value })} options={FREQUENCIES.map((f) => ({ value: f, label: f }))} />
          </Field>
```

Replace with:

```js
          <Field label="Frequency">
            <Select value={profile.frequency} onChange={(e) => onChangeFrequency(e.target.value)} options={FREQUENCIES.map((f) => ({ value: f, label: f }))} />
          </Field>
```

- [ ] **Step 3: Pass the new prop at `ProfilePage`'s call site in `App()`**

Find:

```jsx
      {view === "profile" && (
        <ProfilePage
          state={state} symbol={symbol} onUpdateProfile={updateProfile} onAddItem={addItem} onDeleteItem={deleteItem}
          onAddExpense={addExpense} onDeleteExpense={deleteExpense} onReset={resetAll} onToggleNotif={toggleNotif}
          onOpenAllowanceModal={() => setShowAllowanceModal(true)}
          onGoogleSignInSuccess={handleGoogleSignInSuccess} onGoogleSignOut={handleGoogleSignOut}
        />
      )}
```

Replace with:

```jsx
      {view === "profile" && (
        <ProfilePage
          state={state} symbol={symbol} onUpdateProfile={updateProfile} onAddItem={addItem} onDeleteItem={deleteItem}
          onAddExpense={addExpense} onDeleteExpense={deleteExpense} onReset={resetAll} onToggleNotif={toggleNotif}
          onOpenAllowanceModal={() => setShowAllowanceModal(true)}
          onGoogleSignInSuccess={handleGoogleSignInSuccess} onGoogleSignOut={handleGoogleSignOut}
          onChangeFrequency={changeFrequency}
        />
      )}
```

- [ ] **Step 4: Verify the app builds**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 5: Manual verification**

Run: `npm run dev`. Open Profile, change Frequency to a different value, then check `localStorage.getItem("ledger_budget_app_data_v2")` in the browser DevTools console — confirm `profile.nextAllowanceReminderDate` changed to a plausible new date and `profile.frequency` matches your selection.

- [ ] **Step 6: Commit**

```bash
git add src/App.jsx
git commit -m "$(cat <<'EOF'
Extend submitAllowance, add snoozeAllowanceReminder and changeFrequency

submitAllowance now resets the reminder date/snooze flag on every
renewal; changeFrequency keeps the reminder cadence consistent when
the user changes their allowance frequency on the Profile page.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: `AllowanceReminderModal` component

**Files:**
- Modify: `src/App.jsx` — add new component (place it near `AllowanceModal`, e.g. directly after it), add `showAllowanceReminderModal` state + handler functions + render block in `App()`.

**Interfaces:**
- Consumes: `Modal`, `Card`, `Btn`, `Field`, `TextInput`, `Select`, `Check` icon, `C` (color palette), `todayISO()` (all already in scope in `App.jsx`); `submitAllowance`, `snoozeAllowanceReminder` (Task 7); `computeSnoozeDate` (Task 2, needs to be added to the `budgetMath.js` import list).
- Produces: `<AllowanceReminderModal profile symbol onClose onSetAmount onLeaveSame onSnooze />`; `showAllowanceReminderModal` state and `setShowAllowanceReminderModal` in `App()`, consumed by Task 10 (carousel's "Input now" button).

- [ ] **Step 1: Add `computeSnoozeDate` to the `budgetMath.js` import**

Update the import (from Task 6) to also include `computeSnoozeDate`:

```js
import {
  toLocalISODate, parseLocalDate, todayISO, daysBetween, addDays, FREQ_DAYS,
  computeNextAllowanceReminderDate, computeSnoozeDate,
} from "./lib/budgetMath.js";
```

- [ ] **Step 2: Add the `AllowanceReminderModal` component**

Place this directly after the existing `AllowanceModal` component definition:

```jsx
const SNOOZE_PRESETS = [1, 3, 7, 14, 30];

function AllowanceReminderModal({ profile, symbol, onClose, onSetAmount, onLeaveSame, onSnooze }) {
  const [mode, setMode] = useState("choose");
  const [amount, setAmount] = useState(profile.allowance);
  const [snoozeDays, setSnoozeDays] = useState(7);
  const [useCustomDate, setUseCustomDate] = useState(false);
  const [customDate, setCustomDate] = useState("");

  if (mode === "setAmount") {
    return (
      <Modal title="Set new allowance" onClose={onClose}>
        <Field label={`Allowance (${symbol})`}>
          <TextInput type="number" autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Btn variant="accent" className="w-full mt-1" onClick={() => onSetAmount(Number(amount) || 0)}>
          <Check size={16} /> Confirm amount
        </Btn>
      </Modal>
    );
  }

  if (mode === "snooze") {
    return (
      <Modal title="Remind me again" onClose={onClose}>
        <label className="flex items-center gap-2 mb-4 text-sm" style={{ color: C.inkSoft, fontFamily: "'Public Sans', sans-serif" }}>
          <input type="checkbox" checked={useCustomDate} onChange={(e) => setUseCustomDate(e.target.checked)} />
          Pick a specific date instead
        </label>
        {useCustomDate ? (
          <Field label="Remind me on">
            <TextInput type="date" value={customDate} onChange={(e) => setCustomDate(e.target.value)} min={todayISO()} />
          </Field>
        ) : (
          <Field label="Remind me in">
            <Select value={snoozeDays} onChange={(e) => setSnoozeDays(Number(e.target.value))}
              options={SNOOZE_PRESETS.map((d) => ({ value: d, label: `${d} day${d === 1 ? "" : "s"}` }))} />
          </Field>
        )}
        <Btn variant="accent" className="w-full mt-1" disabled={useCustomDate && !customDate}
          onClick={() => onSnooze({ fromIso: todayISO(), days: snoozeDays, explicitDate: useCustomDate ? customDate : null })}>
          <Check size={16} /> Confirm
        </Btn>
      </Modal>
    );
  }

  return (
    <Modal title="Time to re-input your allowance" onClose={onClose}>
      <p className="text-sm mb-4" style={{ color: C.inkSoft, fontFamily: "'Public Sans', sans-serif" }}>
        Has your {profile.frequency.toLowerCase()} allowance changed (OT, bonus, deductions)?
      </p>
      <div className="space-y-2">
        <Btn variant="accent" className="w-full" onClick={() => setMode("setAmount")}>Set amount</Btn>
        <Btn variant="ghost" className="w-full" onClick={onLeaveSame}>Leave the same</Btn>
        <Btn variant="ghost" className="w-full" onClick={() => setMode("snooze")}>Remind me again</Btn>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 3: Add state and handlers in `App()`**

Find the existing modal state declarations near the top of `App()`:

```js
  const [showLogModal, setShowLogModal] = useState(false);
  const [showAllowanceModal, setShowAllowanceModal] = useState(false);
  const [showMacroCheckInModal, setShowMacroCheckInModal] = useState(false);
```

Replace with:

```js
  const [showLogModal, setShowLogModal] = useState(false);
  const [showAllowanceModal, setShowAllowanceModal] = useState(false);
  const [showMacroCheckInModal, setShowMacroCheckInModal] = useState(false);
  const [showAllowanceReminderModal, setShowAllowanceReminderModal] = useState(false);
```

Add these handler functions next to `submitAllowance`/`snoozeAllowanceReminder` (defined in Task 7):

```js
  function handleReminderSetAmount(amount) {
    submitAllowance({ amount, currency: profile.currency });
    setShowAllowanceReminderModal(false);
  }
  function handleReminderLeaveSame() {
    submitAllowance({ amount: Number(profile.allowance) || 0, currency: profile.currency });
    setShowAllowanceReminderModal(false);
  }
  function handleReminderSnooze({ fromIso, days, explicitDate }) {
    snoozeAllowanceReminder(computeSnoozeDate({ fromIso, days, explicitDate }));
    setShowAllowanceReminderModal(false);
  }
```

- [ ] **Step 4: Render the modal**

Find the existing modal render block near the end of `App()`'s JSX:

```jsx
      {showAllowanceModal && <AllowanceModal profile={profile} onClose={() => setShowAllowanceModal(false)} onSave={submitAllowance} />}
```

Add directly after it:

```jsx
      {showAllowanceReminderModal && (
        <AllowanceReminderModal
          profile={profile} symbol={symbol}
          onClose={() => setShowAllowanceReminderModal(false)}
          onSetAmount={handleReminderSetAmount}
          onLeaveSame={handleReminderLeaveSame}
          onSnooze={handleReminderSnooze}
        />
      )}
```

- [ ] **Step 5: Verify the app builds**

Run: `npm run build`
Expected: build succeeds. (`showAllowanceReminderModal` is not yet triggered by anything visible — that wiring is Task 10 — so there's nothing to manually click through yet. A successful build is sufficient verification for this task.)

- [ ] **Step 6: Commit**

```bash
git add src/App.jsx
git commit -m "$(cat <<'EOF'
Add AllowanceReminderModal (Set amount / Leave the same / Remind me
again)

Not yet reachable from the UI — Task 10 wires the Dashboard carousel's
"Input now" button to open it.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Remove old due-banner, add Savings/Wants pool stat tiles

**Files:**
- Modify: `src/App.jsx:986-990` (Dashboard's old banner), `src/App.jsx:1029-1033` (Dashboard's stat grid), `src/App.jsx:1487-1498` (Strategy's budget plan card)

**Interfaces:**
- No new functions — pure JSX edits, reading `profile.savingsPool`/`profile.wantsPool` (Task 6) defensively via `|| 0`.

- [ ] **Step 1: Remove the old check-in-due banner from `Dashboard`**

Find (`App.jsx:986-990`):

```jsx
        {dueSoon && (
          <Banner onAction={onCheckIn} actionLabel="Check in">
            Weekly Macro Strategy Check-in is due!
          </Banner>
        )}
```

Delete this block entirely (the `overspent` banner directly below it stays — only this one goes; Flow 4's carousel, added in Task 10, takes over surfacing this).

- [ ] **Step 2: Add Savings/Wants pool stat tiles to the Dashboard**

Find (`App.jsx:1029-1033`):

```jsx
          <div className="grid grid-cols-3 gap-2 mt-4 pt-4" style={{ borderTop: `1px solid ${C.line}` }}>
            <Stat label="Spent" value={fmt(totalSpent, symbol)} tone={overspent ? C.danger : undefined} />
            <Stat label="Allowance" value={fmt(totalAllowance, symbol)} />
            <Stat label="Cash Balance" value={fmt(balance, symbol)} tone={balance < 0 ? C.danger : C.moss} />
          </div>
```

Replace with:

```jsx
          <div className="grid grid-cols-3 gap-2 mt-4 pt-4" style={{ borderTop: `1px solid ${C.line}` }}>
            <Stat label="Spent" value={fmt(totalSpent, symbol)} tone={overspent ? C.danger : undefined} />
            <Stat label="Allowance" value={fmt(totalAllowance, symbol)} />
            <Stat label="Cash Balance" value={fmt(balance, symbol)} tone={balance < 0 ? C.danger : C.moss} />
          </div>
          <div className="grid grid-cols-2 gap-2 mt-3 pt-3" style={{ borderTop: `1px solid ${C.line}` }}>
            <Stat label="Savings Pool" value={fmt(profile.savingsPool || 0, symbol)} tone={C.brass} />
            <Stat label="Wants Pool" value={fmt(profile.wantsPool || 0, symbol)} tone={C.clay} />
          </div>
```

- [ ] **Step 3: Add pool stats to the Strategy page**

Find, in `Strategy` (around `App.jsx:1487-1498`):

```jsx
      <Card className="mb-5">
        <div className="flex gap-2 mb-3">
          <SplitChip label="Needs" pct={budgetSplit.needs} cashVal={fmt(needsCash, symbol)} flexCashVal={committedNeedsPeriod > 0 ? fmt(flexNeedsCash, symbol) : null} color={C.ringBlue} />
          <SplitChip label="Wants" pct={budgetSplit.wants} cashVal={fmt(wantsCash, symbol)} color={C.ringPurple} />
          <SplitChip label="Savings" pct={budgetSplit.savings} cashVal={fmt(savingsCash, symbol)} color={C.brass} />
        </div>
        {committedNeedsPeriod > 0 && (
          <div className="text-[11px] p-2.5 rounded-lg mb-2" style={{ background: C.paperDark, color: C.inkSoft }}>
            💡 <strong>{fmt(committedNeedsPeriod, symbol)}</strong> in fixed expenses auto-deducted from Needs. Available flex Needs cash: <strong>{fmt(flexNeedsCash, symbol)}</strong>.
          </div>
        )}
      </Card>
```

Replace with (adds a stats `Card` directly after it):

```jsx
      <Card className="mb-5">
        <div className="flex gap-2 mb-3">
          <SplitChip label="Needs" pct={budgetSplit.needs} cashVal={fmt(needsCash, symbol)} flexCashVal={committedNeedsPeriod > 0 ? fmt(flexNeedsCash, symbol) : null} color={C.ringBlue} />
          <SplitChip label="Wants" pct={budgetSplit.wants} cashVal={fmt(wantsCash, symbol)} color={C.ringPurple} />
          <SplitChip label="Savings" pct={budgetSplit.savings} cashVal={fmt(savingsCash, symbol)} color={C.brass} />
        </div>
        {committedNeedsPeriod > 0 && (
          <div className="text-[11px] p-2.5 rounded-lg mb-2" style={{ background: C.paperDark, color: C.inkSoft }}>
            💡 <strong>{fmt(committedNeedsPeriod, symbol)}</strong> in fixed expenses auto-deducted from Needs. Available flex Needs cash: <strong>{fmt(flexNeedsCash, symbol)}</strong>.
          </div>
        )}
      </Card>

      <Card className="mb-5 grid grid-cols-2 gap-2">
        <Stat label="Savings Pool" value={fmt(profile.savingsPool || 0, symbol)} tone={C.brass} />
        <Stat label="Wants Pool" value={fmt(profile.wantsPool || 0, symbol)} tone={C.clay} />
      </Card>
```

- [ ] **Step 4: Verify the app builds and check visually**

Run: `npm run build`, then `npm run dev`. Open the Dashboard — confirm the old "Weekly Macro Strategy Check-in is due!" banner no longer appears above the rings, and the two new pool stat tiles render (both showing `0.00` for a fresh profile). Open Strategy — confirm the pool stats card appears below the budget plan card.

- [ ] **Step 5: Commit**

```bash
git add src/App.jsx
git commit -m "$(cat <<'EOF'
Remove old check-in-due banner, add Savings/Wants pool stat tiles

The banner is superseded by Flow 4's carousel (Task 10). Pool totals
are now visible on both Dashboard and Strategy.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: `DashboardCarouselBanner` component

**Files:**
- Modify: `src/App.jsx` — add quote data + new component (place near `Rings`/`Legend`), wire into `Dashboard`, thread `onOpenAllowanceReminder` from `App()`.

**Interfaces:**
- Consumes: `getActiveSlideIds`, `allowanceSlideMode` (Task 5, need to be added to the `budgetMath.js` import list); `daysBetween`, `todayISO` (Task 1, already imported); `fmt`, `C` (already in scope).
- Produces: `<DashboardCarouselBanner profile checkInDue symbol safeToSpend onCheckIn onOpenAllowanceReminder />`, rendered inside `Dashboard`.

- [ ] **Step 1: Add `getActiveSlideIds`/`allowanceSlideMode` to the `budgetMath.js` import**

Update the import (from Task 8) to also include them:

```js
import {
  toLocalISODate, parseLocalDate, todayISO, daysBetween, addDays, FREQ_DAYS,
  computeNextAllowanceReminderDate, computeSnoozeDate,
  getActiveSlideIds, allowanceSlideMode,
} from "./lib/budgetMath.js";
```

- [ ] **Step 2: Add the quote pools and `DashboardCarouselBanner` component**

Place this directly after the `Rings`/`Legend` component definitions (before `NavBar`):

```jsx
const STATIC_QUOTES = [
  "You're doing great, {name}.",
  "Every ringgit counts, {name} — keep it up.",
  "Small steady steps win the month, {name}.",
  "Stay the course, {name}. Your future self says thanks.",
  "{name}, discipline today is freedom tomorrow.",
  "Nice and steady, {name} — that's how budgets get built.",
];

function buildDynamicQuotes({ name, safeToSpend, symbol, savingsPool, wantsPool }) {
  return [
    `${name}, you've got ${fmt(safeToSpend, symbol)} left today — nice pace.`,
    `Your Savings Pool just hit ${fmt(savingsPool, symbol)}, ${name}.`,
    `${name}, your Wants Pool is at ${fmt(wantsPool, symbol)} — getting closer to that wishlist item.`,
  ];
}

function DashboardCarouselBanner({ profile, checkInDue, symbol, safeToSpend, onCheckIn, onOpenAllowanceReminder }) {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 8000);
    return () => clearInterval(id);
  }, []);

  const todayIso = todayISO();
  const activeSlideIds = useMemo(
    () => getActiveSlideIds({
      checkInDue,
      nextAllowanceReminderDate: profile.nextAllowanceReminderDate,
      allowanceReminderSnoozed: !!profile.allowanceReminderSnoozed,
      todayIso,
    }),
    [checkInDue, profile.nextAllowanceReminderDate, profile.allowanceReminderSnoozed, todayIso]
  );
  const slideId = activeSlideIds[tick % activeSlideIds.length];

  const quotePool = useMemo(() => [
    ...STATIC_QUOTES,
    ...buildDynamicQuotes({
      name: profile.name, safeToSpend, symbol,
      savingsPool: profile.savingsPool || 0, wantsPool: profile.wantsPool || 0,
    }),
  ], [profile.name, safeToSpend, symbol, profile.savingsPool, profile.wantsPool]);

  const quoteText = useMemo(
    () => quotePool[Math.floor(Math.random() * quotePool.length)].replace("{name}", profile.name),
    [tick, quotePool]
  );

  let content;
  if (slideId === "checkin") {
    content = (
      <>
        <span>Your weekly Strategy check-in is ready, {profile.name}.</span>
        <button onClick={onCheckIn} className="text-sm font-bold whitespace-nowrap shrink-0" style={{ color: C.brass }}>
          Check in now →
        </button>
      </>
    );
  } else if (slideId === "allowance") {
    const mode = allowanceSlideMode({ nextAllowanceReminderDate: profile.nextAllowanceReminderDate, todayIso });
    const days = daysBetween(todayIso, profile.nextAllowanceReminderDate);
    content = (
      <>
        <span>
          {mode === "due"
            ? `Time to re-input your allowance, ${profile.name}.`
            : `Allowance re-input in ${days} day${days === 1 ? "" : "s"}.`}
        </span>
        <button onClick={onOpenAllowanceReminder} className="text-sm font-bold whitespace-nowrap shrink-0" style={{ color: C.brass }}>
          Input now →
        </button>
      </>
    );
  } else {
    content = <span>{quoteText}</span>;
  }

  return (
    <div
      className="flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl mt-4 text-sm font-medium"
      style={{ background: C.paperDark, color: C.ink, fontFamily: "'Public Sans', sans-serif" }}
    >
      {content}
    </div>
  );
}
```

- [ ] **Step 3: Insert the carousel into `Dashboard`, below the rings**

Find (`App.jsx`, inside `Dashboard`'s "Safe to spend" `Card`):

```jsx
          <Rings
            overallSpent={todaySpentTotal} overallTotal={dailyTotal}
            needsSpent={todaySpentNeeds} needsTotal={dailyFlexNeeds}
            wantsSpent={todaySpentWants} wantsTotal={dailyWants}
            symbol={symbol}
          />
          <div className="text-[11px] text-center -mt-1 mb-1" style={{ color: C.slate, fontFamily: "'Public Sans', sans-serif" }}>Today vs. daily caps</div>
          <div className="grid grid-cols-3 gap-2 mt-4 pt-4" style={{ borderTop: `1px solid ${C.line}` }}>
```

Replace with:

```jsx
          <Rings
            overallSpent={todaySpentTotal} overallTotal={dailyTotal}
            needsSpent={todaySpentNeeds} needsTotal={dailyFlexNeeds}
            wantsSpent={todaySpentWants} wantsTotal={dailyWants}
            symbol={symbol}
          />
          <div className="text-[11px] text-center -mt-1 mb-1" style={{ color: C.slate, fontFamily: "'Public Sans', sans-serif" }}>Today vs. daily caps</div>
          <DashboardCarouselBanner
            profile={profile} checkInDue={dueSoon} symbol={symbol} safeToSpend={safeToSpend}
            onCheckIn={onCheckIn} onOpenAllowanceReminder={onOpenAllowanceReminder}
          />
          <div className="grid grid-cols-3 gap-2 mt-4 pt-4" style={{ borderTop: `1px solid ${C.line}` }}>
```

- [ ] **Step 4: Add the `onOpenAllowanceReminder` prop to `Dashboard`**

Find `Dashboard`'s function signature:

```js
function Dashboard({ state, symbol, dueSoon, onOpenLog, onCheckIn, setView }) {
```

Replace with:

```js
function Dashboard({ state, symbol, dueSoon, onOpenLog, onCheckIn, setView, onOpenAllowanceReminder }) {
```

- [ ] **Step 5: Pass the prop from `App()`'s `Dashboard` call site**

Find:

```jsx
      {view === "dashboard" && (
        <Dashboard
          state={state} symbol={symbol} dueSoon={checkInDue}
          onOpenLog={() => setShowLogModal(true)}
          onCheckIn={() => setShowMacroCheckInModal(true)}
          setView={setView}
        />
      )}
```

Replace with:

```jsx
      {view === "dashboard" && (
        <Dashboard
          state={state} symbol={symbol} dueSoon={checkInDue}
          onOpenLog={() => setShowLogModal(true)}
          onCheckIn={() => setShowMacroCheckInModal(true)}
          onOpenAllowanceReminder={() => setShowAllowanceReminderModal(true)}
          setView={setView}
        />
      )}
```

- [ ] **Step 6: Verify the app builds**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 7: Manual verification**

Run: `npm run dev`. On the Dashboard, confirm the carousel banner appears below the rings and above the stat grid, showing a quote. Wait ~8 seconds and confirm it re-randomizes (or, since only "quote" is active for a fresh profile, confirm the text can change on each tick). Open the browser console and manually set `profile.allowanceReminderSnoozed = true` via a Quick Log workaround isn't available — instead, temporarily edit `nextAllowanceReminderDate` in localStorage to a past date (via DevTools → Application → Local Storage, edit the `ledger_budget_app_data_v2` JSON's `profile.nextAllowanceReminderDate` to yesterday's date) and reload: confirm the "allowance" slide appears with "Time to re-input your allowance..." and clicking "Input now →" opens `AllowanceReminderModal` (from Task 8) — walk through all three of its actions (Set amount, Leave the same, Remind me again) and confirm the modal closes and, for "Remind me again," the carousel's allowance slide switches to the countdown wording. Restore/clear localStorage afterward if this was throwaway test data.

- [ ] **Step 8: Commit**

```bash
git add src/App.jsx
git commit -m "$(cat <<'EOF'
Add DashboardCarouselBanner (Flow 4)

Auto-rotating banner below the dashboard rings: quotes by default,
plus a check-in-due slide and an allowance due/snoozed-countdown
slide when active. Replaces the removed top banners as the single
notification surface, and is the first thing that actually opens
AllowanceReminderModal.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Wishlist affordability fix + non-interactive "Affordable" tag

**Files:**
- Modify: `src/App.jsx` — `TargetItemCard`, `Strategy`, `WishlistModal`, `markPurchased`, `undoPurchase`.

**Interfaces:**
- Consumes: `isItemPurchasable`, `applyWantPurchase`, `undoWantPurchase` (Task 4, need to be added to the `budgetMath.js` import list).

- [ ] **Step 1: Add `isItemPurchasable`, `applyWantPurchase`, `undoWantPurchase` to the `budgetMath.js` import**

Update the import (from Task 10) to also include them:

```js
import {
  toLocalISODate, parseLocalDate, todayISO, daysBetween, addDays, FREQ_DAYS,
  computeNextAllowanceReminderDate, computeSnoozeDate,
  getActiveSlideIds, allowanceSlideMode,
  isItemPurchasable, applyWantPurchase, undoWantPurchase,
} from "./lib/budgetMath.js";
```

- [ ] **Step 2: Make the "Affordable ✓" badge a non-interactive tag in `TargetItemCard`**

Find:

```jsx
          {purchasable ? (
            <button
              onClick={(e) => { e.stopPropagation(); onComplete(); }}
              className="mt-1 text-[11px] font-semibold px-2 py-0.5 rounded"
              style={{ background: C.mossBg, color: C.moss }}
            >
              Affordable ✓
            </button>
          ) : (
            <div className="text-[10px]" style={{ color: C.slate }}>Save more</div>
          )}
```

Replace with:

```jsx
          {purchasable ? (
            <span
              className="mt-1 inline-block text-[11px] font-semibold px-2 py-0.5 rounded"
              style={{ background: C.mossBg, color: C.moss }}
            >
              Affordable ✓
            </span>
          ) : (
            <div className="text-[10px]" style={{ color: C.slate }}>Save more</div>
          )}
```

(The swipe-left-to-buy gesture on `TargetItemCard`'s `SwipeCard` wrapper is untouched — it remains the only way to mark an item purchased.)

- [ ] **Step 3: Fix `purchasable` in `Strategy`**

Find, inside `Strategy` (near the top, where `balance`/`budgetSplit` are destructured):

```js
  const { profile, items, expenses, logs, budgetSplit } = state;
  const balance = computeBalance(profile, logs);
  const allowance = Number(profile.allowance) || 0;
```

Replace with:

```js
  const { profile, items, expenses, logs, budgetSplit } = state;
  const balance = computeBalance(profile, logs);
  const allowance = Number(profile.allowance) || 0;
  const wantsPool = profile.wantsPool || 0;
```

Find:

```jsx
          <TargetItemCard
            key={item.id}
            item={item}
            symbol={symbol}
            purchasable={balance >= item.cost}
            onDelete={() => onDeleteItem(item.id)}
            onComplete={() => onMarkPurchased(item)}
            onTap={() => setEditingItem(item)}
          />
```

Replace with:

```jsx
          <TargetItemCard
            key={item.id}
            item={item}
            symbol={symbol}
            purchasable={isItemPurchasable(item, balance, wantsPool)}
            onDelete={() => onDeleteItem(item.id)}
            onComplete={() => onMarkPurchased(item)}
            onTap={() => setEditingItem(item)}
          />
```

Find, in the `WishlistModal` render block inside `Strategy`:

```jsx
      {showWishlist && (
        <WishlistModal items={items} symbol={symbol} balance={balance} onClose={() => setShowWishlist(false)}
          onDelete={onDeleteItem} onComplete={onMarkPurchased} onTap={(item) => setEditingItem(item)} />
      )}
```

Replace with:

```jsx
      {showWishlist && (
        <WishlistModal items={items} symbol={symbol} balance={balance} wantsPool={wantsPool} onClose={() => setShowWishlist(false)}
          onDelete={onDeleteItem} onComplete={onMarkPurchased} onTap={(item) => setEditingItem(item)} />
      )}
```

- [ ] **Step 4: Fix `purchasable` in `WishlistModal`**

Find:

```jsx
function WishlistModal({ items, symbol, balance, onClose, onDelete, onComplete, onTap }) {
  const sorted = sortByRelevance(items.filter((i) => !i.purchased), balance);
  return (
    <Modal title="Full wishlist" onClose={onClose}>
      <div className="space-y-2 max-h-[60vh] overflow-y-auto">
        {sorted.length === 0 && <EmptyRow text="Nothing in your wishlist" />}
        {sorted.map((item) => (
          <TargetItemCard key={item.id} item={item} symbol={symbol} purchasable={balance >= item.cost}
            onDelete={() => onDelete(item.id)} onComplete={() => onComplete(item)} onTap={() => onTap(item)} />
        ))}
      </div>
    </Modal>
  );
}
```

Replace with:

```jsx
function WishlistModal({ items, symbol, balance, wantsPool, onClose, onDelete, onComplete, onTap }) {
  const sorted = sortByRelevance(items.filter((i) => !i.purchased), balance);
  return (
    <Modal title="Full wishlist" onClose={onClose}>
      <div className="space-y-2 max-h-[60vh] overflow-y-auto">
        {sorted.length === 0 && <EmptyRow text="Nothing in your wishlist" />}
        {sorted.map((item) => (
          <TargetItemCard key={item.id} item={item} symbol={symbol} purchasable={isItemPurchasable(item, balance, wantsPool)}
            onDelete={() => onDelete(item.id)} onComplete={() => onComplete(item)} onTap={() => onTap(item)} />
        ))}
      </div>
    </Modal>
  );
}
```

- [ ] **Step 5: Update `wantsPool` on purchase/undo in `App()`**

Find:

```js
  function markPurchased(item) {
    const logId = uid();
    const nextItems = items.map((i) => (i.id === item.id ? { ...i, purchased: true, purchasedDate: todayISO(), purchaseLogId: logId } : i));
    const nextLogs = [...logs, {
      id: logId, type: "expense", category: item.type === "need" ? "needs" : "wants",
      amount: item.cost, note: item.name, date: todayISO(),
    }];
    setItems(nextItems); setLogs(nextLogs);
    persist({ items: nextItems, logs: nextLogs });
  }
  function undoPurchase(item) {
    const nextItems = items.map((i) => (i.id === item.id ? { ...i, purchased: false, purchasedDate: null, purchaseLogId: null } : i));
    const nextLogs = item.purchaseLogId ? logs.filter((l) => l.id !== item.purchaseLogId) : logs;
    setItems(nextItems); setLogs(nextLogs);
    persist({ items: nextItems, logs: nextLogs });
  }
```

Replace with:

```js
  function markPurchased(item) {
    const logId = uid();
    const nextItems = items.map((i) => (i.id === item.id ? { ...i, purchased: true, purchasedDate: todayISO(), purchaseLogId: logId } : i));
    const nextLogs = [...logs, {
      id: logId, type: "expense", category: item.type === "need" ? "needs" : "wants",
      amount: item.cost, note: item.name, date: todayISO(),
    }];
    setItems(nextItems); setLogs(nextLogs);
    const patch = { items: nextItems, logs: nextLogs };
    if (item.type === "want") {
      const nextProfile = { ...profile, wantsPool: applyWantPurchase(profile.wantsPool, item.cost) };
      setProfile(nextProfile);
      patch.profile = nextProfile;
    }
    persist(patch);
  }
  function undoPurchase(item) {
    const nextItems = items.map((i) => (i.id === item.id ? { ...i, purchased: false, purchasedDate: null, purchaseLogId: null } : i));
    const nextLogs = item.purchaseLogId ? logs.filter((l) => l.id !== item.purchaseLogId) : logs;
    setItems(nextItems); setLogs(nextLogs);
    const patch = { items: nextItems, logs: nextLogs };
    if (item.type === "want") {
      const nextProfile = { ...profile, wantsPool: undoWantPurchase(profile.wantsPool, item.cost) };
      setProfile(nextProfile);
      patch.profile = nextProfile;
    }
    persist(patch);
  }
```

- [ ] **Step 6: Verify the app builds**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 7: Manual verification**

Run: `npm run dev`. Add a "want" wishlist item costing more than your current Wants Pool (e.g. RM400, with a fresh profile whose Wants Pool is RM0.00) — confirm it shows "Save more," not "Affordable ✓," even if your overall Cash Balance covers it. Confirm the "Affordable ✓" tag (on any item where the pool does cover the cost) is no longer clickable — tapping it does nothing, while swiping left still marks the item purchased and decrements the Wants Pool stat tile (from Task 9). Add a "need" item and confirm its affordability still reflects total Cash Balance, unchanged from before.

- [ ] **Step 8: Commit**

```bash
git add src/App.jsx
git commit -m "$(cat <<'EOF'
Fix wishlist affordability to use the Wants pool, not total balance

"want"-type items now check isItemPurchasable against wantsPool
instead of total cash balance; "need"-type items are unchanged. The
"Affordable" badge is a non-interactive tag — the swipe-left gesture
remains the only way to mark an item purchased.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: Weekly check-in banks under-spend into the pools

**Files:**
- Modify: `src/App.jsx` — `MacroCheckInModal`, `applyRecommendedSplit`.

**Interfaces:**
- Consumes: `computeWeeklyUnderspend` (Task 3), `bankUnderspend` (Task 4) — need to be added to the `budgetMath.js` import list.

- [ ] **Step 1: Add `computeWeeklyUnderspend`, `bankUnderspend` to the `budgetMath.js` import**

Update the import (from Task 11) to also include them:

```js
import {
  toLocalISODate, parseLocalDate, todayISO, daysBetween, addDays, FREQ_DAYS,
  computeNextAllowanceReminderDate, computeSnoozeDate,
  getActiveSlideIds, allowanceSlideMode,
  isItemPurchasable, applyWantPurchase, undoWantPurchase,
  computeWeeklyUnderspend, bankUnderspend,
} from "./lib/budgetMath.js";
```

- [ ] **Step 2: Compute the week's under-spend inside `MacroCheckInModal`**

Find, inside `MacroCheckInModal`:

```js
  const recommendedDailyCap = (remainingCash / daysRemaining).toFixed(2);
  const committedNeedsMonthly = expenses
    .filter((e) => e.category === "needs")
    .reduce((s, e) => s + expenseMonthly(e.amount, e.freq), 0);

  const smartSplitRecommendation = useMemo(() => {
    return suggestSplit(committedNeedsMonthly, allowanceMonthly(totalAllowance, profile.frequency));
  }, [committedNeedsMonthly, totalAllowance, profile.frequency]);
```

Replace with:

```js
  const recommendedDailyCap = (remainingCash / daysRemaining).toFixed(2);
  const committedNeedsMonthly = expenses
    .filter((e) => e.category === "needs")
    .reduce((s, e) => s + expenseMonthly(e.amount, e.freq), 0);

  const smartSplitRecommendation = useMemo(() => {
    return suggestSplit(committedNeedsMonthly, allowanceMonthly(totalAllowance, profile.frequency));
  }, [committedNeedsMonthly, totalAllowance, profile.frequency]);

  const committedNeedsPeriod = (committedNeedsMonthly / 30) * daysInPeriod;
  const grossNeedsBudget = (totalAllowance * budgetSplit.needs) / 100;
  const wantsBudgetTotal = (totalAllowance * budgetSplit.wants) / 100;
  const flexNeedsBudget = Math.max(0, grossNeedsBudget - committedNeedsPeriod);
  const dailyFlexNeeds = profile.dailyNeedsCap != null ? profile.dailyNeedsCap : flexNeedsBudget / daysInPeriod;
  const dailyWants = profile.dailyWantsCap != null ? profile.dailyWantsCap : wantsBudgetTotal / daysInPeriod;

  const { weeklyNeedsUnderspend, weeklyWantsUnderspend } = useMemo(
    () => computeWeeklyUnderspend({ logs, dailyFlexNeeds, dailyWants, todayIso: todayISO() }),
    [logs, dailyFlexNeeds, dailyWants]
  );
```

- [ ] **Step 3: Show the banked amount in the modal**

Find, inside `MacroCheckInModal`'s JSX, the "Past 7 Days Spent" `Card` (it ends with the `grid grid-cols-2` row showing Needs (Flex)/Wants):

```jsx
        <Card className="space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: C.slate }}>Past 7 Days Spent</div>
          <div className="flex justify-between items-baseline">
            <span className="text-2xl font-bold tabular-nums" style={{ fontFamily: "'IBM Plex Mono', monospace", color: C.ink }}>
              {fmt(totalSpent7, symbol)}
            </span>
            <span className="text-xs font-semibold" style={{ color: weeklyVariance > 0 ? C.danger : C.moss }}>
              {weeklyVariance > 0 ? `+${fmt(weeklyVariance, symbol)} over target pace` : `${fmt(Math.abs(weeklyVariance), symbol)} under target pace`}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs pt-2 border-t" style={{ borderColor: C.line }}>
            <div><span style={{ color: C.slate }}>Needs (Flex):</span> <strong>{fmt(spentNeeds7, symbol)}</strong></div>
            <div><span style={{ color: C.slate }}>Wants:</span> <strong>{fmt(spentWants7, symbol)}</strong></div>
          </div>
        </Card>
```

Add directly after this `</Card>`:

```jsx
        <Card>
          <div className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: C.slate }}>Banked This Week</div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div><span style={{ color: C.slate }}>Needs (Flex):</span> <strong style={{ color: C.brass }}>{fmt(weeklyNeedsUnderspend, symbol)}</strong></div>
            <div><span style={{ color: C.slate }}>Wants:</span> <strong style={{ color: C.clay }}>{fmt(weeklyWantsUnderspend, symbol)}</strong></div>
          </div>
          <p className="text-[11px] mt-2" style={{ color: C.slate }}>
            Unspent daily budget doesn't roll into tomorrow's cap — it banks here toward your Savings and Wants pools when you apply below.
          </p>
        </Card>
```

- [ ] **Step 4: Pass the banked amounts through "Apply Smart Rebalance"**

Find:

```jsx
          <Btn
            variant="accent"
            className="w-full text-xs"
            onClick={() => onApplyRecommendation({ split: smartSplitRecommendation, dailyCap: Number(recommendedDailyCap) })}
          >
            Apply Smart Rebalance & Finish Check-In
          </Btn>
```

Replace with:

```jsx
          <Btn
            variant="accent"
            className="w-full text-xs"
            onClick={() => onApplyRecommendation({
              split: smartSplitRecommendation,
              dailyCap: Number(recommendedDailyCap),
              weeklyNeedsUnderspend,
              weeklyWantsUnderspend,
            })}
          >
            Apply Smart Rebalance & Finish Check-In
          </Btn>
```

- [ ] **Step 5: Bank the under-spend in `applyRecommendedSplit`**

Find:

```js
  function applyRecommendedSplit({ split, dailyCap }) {
    const needsWantsTotal = split.needs + split.wants;
    const needsPct = needsWantsTotal > 0 ? split.needs / needsWantsTotal : 0.5;
    const wantsPct = needsWantsTotal > 0 ? split.wants / needsWantsTotal : 0.5;
    const dailyNeedsCap = dailyCap * needsPct;
    const dailyWantsCap = dailyCap * wantsPct;
    setBudgetSplit(split);
    setProfile((prev) => {
      const next = {
        ...prev,
        nextCheckInDate: addDays(prev.nextCheckInDate || todayISO(), 7),
        dailyCapOverride: dailyCap,
        dailyNeedsCap,
        dailyWantsCap,
      };
      persist({ budgetSplit: split, profile: next });
      return next;
    });
    setShowMacroCheckInModal(false);
  }
```

Replace with:

```js
  function applyRecommendedSplit({ split, dailyCap, weeklyNeedsUnderspend, weeklyWantsUnderspend }) {
    const needsWantsTotal = split.needs + split.wants;
    const needsPct = needsWantsTotal > 0 ? split.needs / needsWantsTotal : 0.5;
    const wantsPct = needsWantsTotal > 0 ? split.wants / needsWantsTotal : 0.5;
    const dailyNeedsCap = dailyCap * needsPct;
    const dailyWantsCap = dailyCap * wantsPct;
    setBudgetSplit(split);
    setProfile((prev) => {
      const pools = bankUnderspend(
        { savingsPool: prev.savingsPool, wantsPool: prev.wantsPool },
        weeklyNeedsUnderspend,
        weeklyWantsUnderspend
      );
      const next = {
        ...prev,
        nextCheckInDate: addDays(prev.nextCheckInDate || todayISO(), 7),
        dailyCapOverride: dailyCap,
        dailyNeedsCap,
        dailyWantsCap,
        savingsPool: pools.savingsPool,
        wantsPool: pools.wantsPool,
      };
      persist({ budgetSplit: split, profile: next });
      return next;
    });
    setShowMacroCheckInModal(false);
  }
```

- [ ] **Step 6: Verify the app builds**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 7: Manual verification**

Run: `npm run dev`. Log a few expenses under both the Needs and Wants caps on today's date (so there's a clear under-spend), then open the weekly check-in (Strategy → "Start Check-In," or via the carousel's "Check in now" once due — you can also force it due by editing `profile.nextCheckInDate` in localStorage to a past date). Confirm the "Banked This Week" card shows non-zero amounts. Click "Apply Smart Rebalance & Finish Check-In" and confirm the Dashboard/Strategy Savings Pool and Wants Pool stat tiles (from Task 9) increase by roughly those amounts.

- [ ] **Step 8: Commit**

```bash
git add src/App.jsx
git commit -m "$(cat <<'EOF'
Bank weekly under-spend into Savings/Wants pools on check-in apply

MacroCheckInModal now computes and displays the week's identified
under-spend; applying the smart rebalance banks it into the pools
via bankUnderspend, alongside its existing job of setting next
week's flat daily caps.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 13: Full verification pass

**Files:** none (verification only).

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: every test across all of `src/lib/budgetMath.test.js` PASSES.

- [ ] **Step 2: Run a production build**

Run: `npm run build`
Expected: succeeds with no errors or warnings about unused/undefined variables.

- [ ] **Step 3: Manual end-to-end walkthrough**

Run: `npm run dev` and, starting from a fresh profile (use "Reset All Data" on the Profile page if needed), walk through:

1. **Onboarding** completes normally; confirm no console errors.
2. **Dashboard carousel** shows a quote, rotates every ~8s.
3. Edit `profile.nextCheckInDate` in localStorage to yesterday, reload: carousel shows the check-in slide; "Check in now →" opens `MacroCheckInModal`; confirm the "Banked This Week" card appears; apply the rebalance; confirm pool stat tiles increase and the carousel's check-in slide disappears.
4. Edit `profile.nextAllowanceReminderDate` to yesterday, reload: carousel shows "Time to re-input your allowance..."; "Input now →" opens `AllowanceReminderModal`. Test all three actions in turn (re-editing the date back to the past between tests as needed): "Set amount" updates the allowance and clears the slide; "Leave the same" does the same without changing the number; "Remind me again" (try both a preset day offset and a custom date) closes the modal and switches the carousel to the countdown wording ("Allowance re-input in N days").
5. **Wishlist:** with Wants Pool at RM0, add a "want" item costing more than RM0 — confirm it shows "Save more," never "Affordable ✓," regardless of total Cash Balance. Bank some Wants underspend via a check-in (step 3) until the pool covers the item's cost, confirm it now shows "Affordable ✓" as a plain tag (not clickable), and confirm swiping left still marks it purchased and decrements the Wants Pool tile. Add a "need" item and confirm its affordability still tracks total Cash Balance.
6. Confirm the old top-of-Dashboard "Weekly Macro Strategy Check-in is due!" banner is gone for good (superseded by the carousel).

- [ ] **Step 4: Confirm git state is clean**

Run: `git status`
Expected: no uncommitted changes (everything from Tasks 1–12 is already committed); working tree clean.

No commit for this task — it's verification only.

---

## Self-Review Notes

- **Spec coverage:** Flow 1 (Tasks 2, 6, 7, 8), Flow 2 (Tasks 3, 4, 12), Flow 3 (Tasks 4, 11), Flow 4 (Tasks 5, 9, 10), Data model (Task 6), Testing (Tasks 1–5, 13) — every section of the spec maps to at least one task.
- **Placeholder scan:** no TBDs; every step has literal code, not a description of code.
- **Type/name consistency:** `wantsPool`/`savingsPool` (not `wantPool`/`savingPool`), `computeWeeklyUnderspend` (not `getWeeklyUnderspend`), `allowanceSlideMode`/`getActiveSlideIds` (not renamed anywhere else), `AllowanceReminderModal`/`DashboardCarouselBanner` component names used identically at definition and call sites — verified consistent across all 13 tasks.
