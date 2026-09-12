# Design: Allowance Reminder, Adaptive Weekly Learning & Wishlist Fix

## Context

This app (`src/App.jsx`, a single-file React app with `localStorage`-only
persistence, no backend) currently has no way to prompt the user to
re-enter their allowance/salary each period, and its weekly "Macro
Strategy Check-In" only reacts to the last 7 days of *spending pace* — it
never learns from days where the user under-spent. Separately, the
wishlist's "Affordable" check compares an item's cost against the user's
**total cash balance**, which is wrong: it lets a big-ticket wishlist item
look affordable just because overall savings (money earmarked for needs,
bills, etc.) happen to cover it, and tapping the "Affordable ✓" badge
silently marks the item purchased with no confirmation.

This was prompted by the user's real workflow: they worked only 8 days in
August (got RM155 that month), and their new allowance was credited on
Sep 5th. They want the app to actively remind them to re-input their
allowance every period, to react intelligently when they *don't* spend
their full daily budget (banking it toward savings/wishlist instead of
silently inflating tomorrow's cap), and to fix the wishlist affordability
check so it only draws on money actually earmarked for discretionary
"wants" purchases.

The intended outcome is three connected features, designed together
because they share data (the weekly check-in produces the banked amounts
that both the reminder-driven allowance renewal and the wishlist
affordability check depend on):

1. A recurring allowance/salary re-input reminder.
2. The weekly check-in learning from under-spent days and banking the
   difference into two new running pools instead of ever inflating the
   next day's spendable cap.
3. Wishlist "want" items checking affordability against the new Wants
   pool instead of total cash balance, and the "Affordable" badge
   becoming a non-interactive tag.

No push notifications requiring a backend are in scope — see "Out of
scope" below.

## Data model changes

All changes are additive fields on the existing `profile` object,
persisted the same way every other profile field is (via the existing
`persist()` / `storageHelper` mechanism in `App.jsx`). Existing
users' saved data is missing these fields, so they are patched in with
defaults in the same `useEffect` in `App()` that already patches in
fields like `checkInDay` and `tier` today (`App.jsx:1717-1750`).

| Field | Type | Default | Meaning |
|---|---|---|---|
| `nextAllowanceReminderDate` | ISO date string | computed on patch | Next date the allowance re-input reminder should fire. |
| `savingsPool` | number | `0` | Running total of Needs-flex money identified as under-spent at past weekly check-ins. A labeled breakdown of the existing cash balance — **not** money on top of it. |
| `wantsPool` | number | `0` | Running total of Wants money identified as under-spent at past weekly check-ins, minus what's been spent on purchased "want"-type wishlist items. Also a labeled breakdown of the existing balance. |

`nextAllowanceReminderDate` default-patch logic: if missing, compute as
`addDays(profile.lastAllowanceUpdate, FREQ_DAYS[profile.frequency])`
(falling back to `addDays(todayISO(), FREQ_DAYS[frequency])` if
`lastAllowanceUpdate` is also missing).

No changes to `items`, `expenses`, or `logs` shapes.

## Flow 1 — Allowance reminder

**Trigger:** A `Banner` (reusing the existing `Banner` component) appears
on the Dashboard, using the same due/not-due pattern as the existing
weekly check-in banner (`checkInDue` in `App.jsx:1899`), gated on
`todayISO() >= profile.nextAllowanceReminderDate`. This works for
whatever `frequency` the user has chosen (Daily/Weekly/Monthly/Yearly) —
not hardcoded to monthly.

**New component `AllowanceReminderModal`**, opened from the banner's
action button. Presents three primary actions:

- **Set amount** — reveals an amount input (same pattern as the existing
  `AllowanceModal`). Confirming calls the (extended) `submitAllowance`.
- **Leave the same** — immediately calls `submitAllowance` with the
  current `profile.allowance` value, no extra input needed.
- **Remind me again** — reveals a dropdown of preset offsets (1, 3, 7,
  14, 30 days) plus a "Pick a date" option that swaps in a date field
  (mirroring the existing `EditDateModal` pattern). Confirming calls a
  new `snoozeAllowanceReminder(newDate)`.

**`submitAllowance` extension** (`App.jsx:1850-1860`): in addition to its
current behavior (set allowance/currency, reset `lastAllowanceUpdate`,
increment `totalReceived`, clear `dailyCapOverride`/`dailyNeedsCap`/
`dailyWantsCap`), it now also sets
`nextAllowanceReminderDate = addDays(todayISO(), FREQ_DAYS[frequency])`.
This makes both entry points — the existing manual "Allowance Base"
editor on the Profile page, and the new reminder modal — behave
consistently: any time the allowance is (re-)confirmed, the reminder
clock restarts.

**`snoozeAllowanceReminder(newDate)`** (new function in `App.jsx`,
alongside `skipCheckIn`): sets only
`profile.nextAllowanceReminderDate = newDate`; nothing else about the
profile changes.

**Frequency changes:** when the user changes `profile.frequency` on the
Profile page, also recompute
`nextAllowanceReminderDate = addDays(profile.lastAllowanceUpdate, FREQ_DAYS[newFrequency])`
so the reminder cadence stays consistent with the new period length.

## Flow 2 — Weekly check-in learns from under-spent days

The existing weekly Macro Strategy Check-in (`MacroCheckInModal`,
`App.jsx:545-636`, triggered independently of allowance frequency via
`profile.checkInDay`/`nextCheckInDate`) gains a new calculation step.

**Identifying under-spend:** for each of the last 7 days, compute
`needsUnderspendDay = max(0, dailyFlexNeeds - thatDaysNeedsSpend)` and
`wantsUnderspendDay = max(0, dailyWants - thatDaysWantsSpend)`, using the
currently-active flat daily caps (consistent with the "same cap every day
of the week" behavior already produced by `dailyCapOverride`/
`dailyNeedsCap`/`dailyWantsCap`). Sum across the week into
`weeklyNeedsUnderspend` and `weeklyWantsUnderspend`.

**Surfacing it:** the modal displays a card — "You banked
`{fmt(weeklyNeedsUnderspend)}` in Needs and `{fmt(weeklyWantsUnderspend)}`
in Wants this week" — so the banking is visible, not a silent background
change. This sits alongside the existing "Past 7 Days Spent" card.

**Applying it:** pressing the existing **Apply Smart Rebalance** button
(`onApplyRecommendation`) now passes `weeklyNeedsUnderspend` and
`weeklyWantsUnderspend` through to `applyRecommendedSplit` in `App.jsx`
(`App.jsx:1821-1840`), which — in addition to its current job of setting
the new split and per-day caps — adds:

```
savingsPool: (prev.savingsPool || 0) + weeklyNeedsUnderspend
wantsPool: (prev.wantsPool || 0) + weeklyWantsUnderspend
```

No other change to the existing recommendation math
(`recommendedDailyCap`, `suggestSplit`) — the new daily cap for the
coming week continues to be computed exactly as it is today, from
remaining cash and remaining days. The under-spend identification is
purely about banking a label onto money that was already unspent, not
about additionally reducing or inflating next week's spendable cap.
"Snooze 7d" (the existing skip action) does **not** bank anything — it
only defers the check-in, unchanged from today.

## Flow 3 — Wishlist fix

**Affordability check** used by `TargetItemCard`, `WishlistModal`, and
`Strategy` (currently `purchasable = balance >= item.cost` everywhere it
appears) becomes type-dependent:

- `item.type === "want"` → `purchasable = wantsPool >= item.cost`
- `item.type === "need"` → `purchasable = balance >= item.cost`
  (unchanged from today)

**Marking purchased** (`markPurchased`, `App.jsx:1795-1804`): when the
purchased item is a "want", additionally subtract its cost from
`wantsPool` (floored at 0) as part of the same persisted patch.
**Undoing a purchase** (`undoPurchase`, `App.jsx:1805-1810`) does the
symmetric add-back for "want" items. "Need" purchases are unaffected —
they continue to only touch `logs`/`items` as today.

**The "Affordable ✓" badge** (`App.jsx:1281-1288`, inside
`TargetItemCard`) stops being a button with an `onClick` that calls
`onComplete()`. It becomes a plain, non-interactive visual tag (same
styling, no click handler, no `stopPropagation`). The existing swipe-left
gesture (`SwipeCard`'s `onSwipeLeft={purchasable ? onComplete : undefined}`)
remains the only way to mark an item purchased — that gating logic is
unchanged, it simply now reflects the new pool-based `purchasable` value.

## Visibility — new UI

Two new stat tiles, using the existing `Stat` component pattern:

- **Dashboard** (`App.jsx:918-1081`): add "Savings Pool" and "Wants Pool"
  to the stat row alongside the existing Spent/Allowance/Cash Balance
  stats (or a second row if space is tight — implementation's call,
  following the existing grid pattern).
- **Strategy** (`App.jsx:1429-1573`): add the same two figures near the
  existing `SplitChip` row, so the split percentages and the banked pool
  totals are visible together.

## Edge cases & error handling

- **Missing fields on old saved data:** handled by the patch-on-load
  logic described in "Data model changes" above — every read of
  `savingsPool`/`wantsPool` elsewhere in the code should still default
  via `(profile.savingsPool || 0)` defensively, matching the existing
  codebase's style (e.g. `Number(profile.totalReceived) || 0`).
- **Week spans an allowance renewal:** if the allowance changes mid-week
  (via the reminder or manual edit), `dailyFlexNeeds`/`dailyWants` used
  for the under-spend calculation reflect current state, not historical
  per-day state. This matches how the rest of the app already computes
  daily caps (no historical cap tracking exists today) and is an
  accepted minor imprecision rather than new tracking infrastructure.
- **Pool never goes negative:** both pools are floored at 0 on every
  mutation (`Math.max(0, ...)`), matching the existing `Math.max(0, ...)`
  style already used for `flexNeedsBudget` etc.
- **Want item purchase gating unchanged:** as today, an unaffordable want
  item cannot be swipe-purchased (`onSwipeLeft` is only wired when
  `purchasable` is true) — this spec does not add a way to force-purchase
  an unaffordable item. That gate simply now reads from `wantsPool`
  instead of `balance`.

## Testing

This repo currently has no test framework configured (`package.json` has
no `test` script and no test library). As agreed, this change introduces
**Vitest** for the new pure calculation logic — not for the React
components/UI, which remain manually verified in the browser like the
rest of the app. New unit tests should cover:

- Weekly under-spend summation (`needsUnderspendDay`/`wantsUnderspendDay`
  math, floored at 0, summed correctly across 7 days including days with
  zero spend and days that overspent the cap).
- `submitAllowance`'s new `nextAllowanceReminderDate` computation across
  all four frequencies.
- `snoozeAllowanceReminder` date math (both preset day-offsets and an
  explicit chosen date).
- Pool arithmetic: banking on check-in apply, decrement on want purchase,
  add-back on undo, floor-at-zero behavior.

Manual verification (in the browser, via `npm run dev`) covers the UI
flows: reminder banner appearing/disappearing, all three reminder modal
actions, the weekly check-in's new banked-amount card, the wishlist
badge no longer being clickable, and the new stat tiles rendering
correctly.

## Out of scope

- **Real push notifications** (Web Push via service worker + VAPID keys
  + a backend to store subscriptions + a cron trigger). Deploying to
  Vercel would provide the HTTPS/hosting/cron piece but not the
  database or service-worker configuration this would additionally
  require. Explicitly deferred; the in-app banner/modal approach here is
  the complete reminder mechanism for this spec.
- **Spending from the Savings pool.** It is purely additive/informational
  in this spec — no "spend from savings" flow exists yet.
- **Forcing a wishlist purchase when unaffordable.** Unchanged from
  today's gating behavior.
- **Cross-device sync.** Still fully local to the device via
  `localStorage`, unrelated to this change.
