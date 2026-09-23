# Day Book v2 — "professional" spec: expenses→P&L, trend chart, categories, party links

Status: proposal, 23 Sep 2026. Risk class: 🔴 (financial records — Day Book already ships,
this changes what it computes and displays, not just how it looks). No code written.
Destination: `Desktop\jewelos\docs\DAYBOOK-SPEC-v2.md`. HANDOFF entry is separate.

## 0. Why this exists

Tanish's words: "the day book we have is very cheap and unprofessional... UI UX is very bad
and so simple, it won't create an impression." Traced that complaint against real competitor
software (Prime/Rojmel, GoldBook, JewellerBook, Vyapar Cash Book, Zoho Daybook, Khatabook) and
against JewelOS's own Reports tab, which already has the visual language Day Book is missing.
Six concrete gaps came out of that comparison, confirmed against the actual code, not guessed:

1. Manual expense entries never reach Reports — `calcMonthProfit()` only reads `S.sales` and
   girvi interest. P&L stops at "Gross Profit." Every competitor leads with a net number.
2. No chart anywhere in Day Book — just rows of text. Reports already has one (`rep-chart`);
   Day Book doesn't reuse it.
3. Categories are a plain string (`DB_CATS[cat].label`) — no color, no icon. Every competitor
   color-codes categories so the list reads at a glance.
4. Manual entries have no link to a person — no customer/supplier/karigar field at all.
5. No receipt/photo attachment on a manual entry.
6. Day Book only ever shows one calendar day (`dbGoDate`) — no week/month trend view.

This spec covers all six as one coherent piece, because they compound: the chart (2) wants a
month view to live in (6), the expense breakdown (1) wants the same month view, and the
category color system (3) is what makes both the chart and the line list legible together.
Build order can still be staged — see §8.

**Explicitly not in this pass:** gold-weight cash book, karigar interest ledgers, rate-cut
settlement (Prime-style fine-weight accounting). Real, but Phase-2/3 scale per the original
spec's own scoping rule — only build if a real shop asks. Do not fold these in here.

## 1. Section 1 — Expenses into Reports (the P&L fix)

### 1.1 What "expense" means for P&L purposes

`S.dayBook.entries` already separates manual lines by `group` (see `DB_CATS` in
`js/10-daybook.js`): `expense` (rent, salary, electricity, tea, transport, repair, misc),
`owner` (drawings, capital), and — per the batch27 non-cash fix — auto lines carry `src`.
**Only `group:'expense'` entries are P&L expenses.** Owner Drawings and Owner Capital are
equity movements, not business costs — they must never reduce Net Profit, exactly like a
real accountant would treat them. Keep this distinction explicit in the code, not implied.

### 1.2 New aggregation function

Add `calcDayBookExpenses(year, month)` in `js/01-sync-core.js`, next to `calcMonthProfit`:

```
function calcDayBookExpenses(year, month){
  var monthStart = new Date(year, month, 1);
  var monthEnd   = new Date(year, month+1, 0, 23, 59, 59);
  var byCat = {}; var total = 0;
  (S.dayBook && S.dayBook.entries || []).forEach(function(e){
    if(e.voided) return;
    if(DB_CATS[e.cat] && DB_CATS[e.cat].group !== 'expense') return;
    var d = new Date(e.date);
    if(d < monthStart || d > monthEnd) return;
    total += e.amount;
    byCat[e.cat] = (byCat[e.cat]||0) + e.amount;
  });
  return { total: total, byCat: byCat };
}
```

Read-only, derived at render time — same pattern the Day Book spec already uses for auto
lines (§4 of the original spec). No new stored field, no export/restore/roundtrip impact.

### 1.3 Wire it into `calcMonthProfit` and `calcAllTimeProfit`

`calcMonthProfit` (js/01-sync-core.js:1702) gains an `expenses` field and a `netProfit` field
alongside the existing `revenue`/`cost`/`profit`/`gst`. `profit` (gross) stays exactly as it
is today — do not change its meaning, other code may depend on it. `netProfit = profit -
expenses.total`. Same addition to `calcAllTimeProfit`.

### 1.4 P&L card changes (`renderReports`, js/03-billing-numbers.js:1130)

Current card stops at "= Gross Profit." Add, in order:

```
(+) Total Revenue
(-) Metal Cost
(-) GST (Govt portion)
= Gross Profit                    [existing, keep as a sub-line, not the headline]
(-) Operating Expenses            [new — tap to expand the category breakdown]
= Net Profit                      [new — this is the headline number now]
```

**Net Profit becomes the number shown in the top `rep-metrics` "Profit" tile**, replacing
gross profit there (gross profit moves down into the P&L card detail only). This matches
every competitor surveyed — none of them lead with a pre-expense number.

Expense breakdown: a small collapsible list under "(-) Operating Expenses" — same visual
pattern as the existing "Top products" table (js/03-billing-numbers.js:1158), one row per
category with its icon (see §3) and amount, sorted descending. Reuses `plRow()`, the helper
already used for every other P&L line — do not invent a second row-rendering function.

### 1.5 Acceptance tests (add to `tests/regression.test.js`)

- A month with zero Day Book expenses: `netProfit === profit` (gross), unchanged from today.
- A ₹5,000 rent entry this month: `netProfit === profit - 5000`.
- An Owner Drawings entry this month: `netProfit` unaffected — drawings never touch it.
- A voided expense entry: excluded from `calcDayBookExpenses`, same as it's already excluded
  from Day Book's own totals.
- An expense entry dated last month: does not appear in this month's `calcDayBookExpenses`.

## 2. Section 2 — Cash-flow trend chart

### 2.1 Where it lives

Reports already renders a 6-month bar chart (`rep-chart`, js/03-billing-numbers.js:1088-1110)
from `chartData` built by looping `calcMonthProfit` per month. Day Book's new chart is the
same idea at day granularity, and it lives in the new Month view (§6), directly under the
date-range header, above the Cash In/Cash Out metric tiles that already exist.

### 2.2 New aggregation function

`dbBuildTrend(fromDateKey, toDateKey)` in `js/10-daybook.js`, next to `dbDayView`: loops each
calendar day in range, calls the existing `dbDayView(dateKey)` for each one (do not
re-implement the in/out/closing logic — that function is already correct, including the
locked-day handling), and returns `[{date, totalIn, totalOut, closing, isClosed}, ...]`.

### 2.3 Rendering

Reuse the exact div-based bar pattern from `rep-chart` (flex column, height as a percentage
of the range max) — two bars per day, cash-in (gold, matches `var(--gold-dark)` used
elsewhere) and cash-out (`var(--danger)`), not stacked, side by side like Reports' own
revenue/profit pair. Default range: last 14 days in Month view; a day with no entries still
gets a zero-height bar slot so the timeline doesn't skip (this also visually flags "no
activity" days, which is itself useful to a shop owner).

Tapping a bar jumps to that day's existing single-day Day Book view (`dbGoDate`) — the chart
is a navigation aid into the detail view that already exists and already works, not a
replacement for it.

## 3. Section 3 — Category color and icon system

### 3.1 Extend `DB_CATS`

Every entry currently has `{dir, label, group}`. Add `icon` and `color` to each:

| cat | icon | color token | group |
|---|---|---|---|
| rent | 🏠 | `var(--danger)` | expense |
| salary | 👤 | `var(--danger)` | expense |
| electricity | 💡 | `var(--danger)` | expense |
| tea | ☕ | `var(--danger)` | expense |
| transport | 🚗 | `var(--danger)` | expense |
| repair | 🔧 | `var(--danger)` | expense |
| misc | 📦 | `var(--danger)` | expense |
| drawings | 💰 | `var(--text3)` | owner |
| capital | 🏦 | `var(--success)` | owner |
| bankDeposit / bankWithdrawal | 🏧 | `var(--text3)` | transfer |
| sale (auto) | 💎 | `var(--gold-dark)` | auto |
| purchase (auto) | 📥 | `var(--text2)` | auto |
| girvi (auto) | 🪙 | `#c9a84c` (matches girvi's own emoji/accent elsewhere) | auto |
| order (auto) | 📝 | `var(--text2)` | auto |

All colors are existing CSS custom properties already used throughout Reports and Girvi —
no new palette. Auto-line colors distinguish source type at a glance, same as the "• auto" /
"• manual" text tags added in batch27, but visual instead of text-only — the two work
together, not as replacements for each other.

### 3.2 Where it shows

- Entry chips (`DB_ENTRY_CHIP_CATS`, js/10-daybook.js:739) render icon + label, colored
  border/background instead of plain buttons — same chip styling already used for Girvi's
  search-filter chips (`.girvi-search-chip`), reused, not reinvented.
- Line list (`_dbPaint`): each line gets a small colored icon badge to the left of the label,
  replacing the current plain-text-only row.
- Month view's per-day list and the expense breakdown (§1.4) both use the same icon+color,
  so a category means the same thing everywhere it appears in Day Book.

## 4. Section 4 — Linking a manual entry to a person

### 4.1 Scope

Only manual entries gain this — auto lines already carry their real source (`sale.customer`,
`purchase.supplier`, `girvi.customer`) and that's out of scope here. Most expense categories
(electricity, tea, misc) realistically have no person to link — this field is **optional**,
never required, and the UI must not make an unlinked entry feel incomplete.

### 4.2 Data model

Add optional `party: {name, phone, customerId}` to a manual entry. `customerId` present when
linked to an existing `S.customers` row; `name`/`phone` alone for a free-text party (a
landlord, an electricity board, an employee not in Customers) — same optional/free-text
pattern `sale.customer`/`sale.phone` already use when a sale isn't tied to a saved customer.

### 4.3 UI

Add-entry form gets one more optional field: "Link to a person (optional)" — text input,
type-ahead against `S.customers` by name or phone. **Before building a new autocomplete
component, grep the sale-creation form for however it currently resolves a typed name against
`S.customers`** (no dedicated reusable picker function was found in this pass — the sale form
may do this inline) and match that exact pattern, so Day Book doesn't introduce a second way
of doing the same lookup.

When present, the party's name renders as a small tag next to the entry in the line list.
Add a "👤 By Person" toggle at the top of Day Book's Month view, styled and behaving exactly
like Girvi's existing `toggleGirviViewMode`/`renderGirviByCustomer` toggle
(js/08-girvi-viewmode.js) — group entries by party instead of by date. Reuse that function's
structure, don't write a parallel grouping implementation.

## 5. Section 5 — Receipt/photo attachment

### 5.1 Reuse, don't rebuild

`gfCompressPhoto(file, cb)` already exists (js/07-settings-plans.js:318) — 512px, JPEG
quality 0.55, lands ~25-50KB per photo. This is the exact tool for the job; call it, don't
write a second image-compression function.

### 5.2 Size budget — this is the real constraint, not the UI

DAYBOOK-SPEC.md §9 already flagged the blob-size risk: "10 manual entries a day is a few
hundred KB a year" assuming text-only entries. A photo on even a fraction of entries changes
that math by orders of magnitude — 50KB × even 2 receipts/day is ~36MB/year, which is not
"a few hundred KB." **Before building this, Claude Code must re-run that estimate with photos
in the mix and flag back to Tanish if it changes the storage-model assumption** (e.g. whether
photos should live in Supabase Storage with just a reference stored in the blob, rather than
inline base64 in `S.dayBook.entries`). Do not ship inline-base64 photos without that check —
this is exactly the kind of thing the original spec's Opus-review gate exists for.

### 5.3 UI

Add-entry form: "📷 Attach receipt (optional)" — camera/gallery picker, same pattern as
wherever the app already attaches a girvi ornament photo. Thumbnail shows in the line list;
tap to view full size in a lightbox (reuse whatever the app already uses for girvi/product
photo viewing, not a new modal).

## 6. Section 6 — Month view

### 6.1 Why

Sections 1, 2 and 4's breakdowns all want a range, not a single day. Rather than bolt a chart
onto the single-day screen, Day Book gets a top-level **Day / Month** toggle. The single-day
view — opening balance, in/out list, close-day flow — stays exactly as it is; it's the
correct screen for actually recording a day and closing it, and is already well-specced and
tested.

### 6.2 Layout (Month view, new)

1. Month picker (prev/next, same pattern as Reports' `changeMonth`/`month-label`).
2. Trend chart (§2) — 14/30-day toggle, tap a bar to jump into that day's single-day view.
3. Metric tiles: Cash In, Cash Out, Net Cash (existing pattern from `dbAutoTotals`, just
   summed across the month instead of one day) — and now also **Operating Expenses** and
   **Net Cash After Expenses**, matching the same headline change made to Reports in §1.4.
4. Expense breakdown by category (icon + color from §3), same list styling as §1.4's P&L
   card version — this is the same data, shown in both places, so it must be the same
   component/function rendering it in both, not two copies that can drift.
5. Day-by-day list: date, closing balance, small in/out figures, lock icon if closed — tap
   to drill into that day's existing single-day view. This is Month view's equivalent of
   Reports' "Sales in [month]" table.
6. "👤 By Person" toggle (§4.3) switches the day-by-day list into a party-grouped list.

### 6.3 Mechanics

`dbBuildTrend` (§2.2) plus `calcDayBookExpenses` (§1.2) supply everything Month view needs —
no new storage, no new sync/export keys, nothing that touches `dbAutoTotals` (the locked-day
sweep still diffs against exactly what it does today). Month view is a read-only aggregation
layer over data that already exists and is already correct.

## 7. What does NOT change

- `dbAutoLines`, `dbAutoTotals`, `dbDayView`, `dbIsCash`, the locked-day sweep
  (`dbSweepRestatements`, `dbPostAdjustment`) — byte-for-byte unchanged. Every addition here
  reads from these, none of them are modified. This is the same discipline batch27's non-cash
  fix followed ("only what gets shown changed") and it must hold here too, because getting
  the locked-day math wrong is a 🔴 mistake, not a cosmetic one.
- Single-day Day Book view's own layout and close-day flow — unchanged.
- `S.dayBook` storage shape — unchanged except the new optional `party`/`photo` fields on a
  manual entry (both optional, both additive, both safe for export/restore since they're
  just new optional keys on an existing object — still needs the usual
  `backup-check.js`/`roundtrip.js` pass per the original spec's own rule).

## 8. Suggested build order (stageable, not all-or-nothing)

1. §1 (expenses→P&L) — highest value, no UI risk, pure aggregation.
2. §3 (category icons/colors) — cheap, high visual impact, unblocks everything else looking
   coherent.
3. §2 + §6 (chart + Month view) — the biggest single piece, built together since the chart's
   real home is Month view.
4. §4 (party linking) — needs the grep-first step in §4.3 before starting.
5. §5 (photo attachment) — gate on the storage-model check in §5.2 before writing any code.

## 9. Acceptance tests (beyond §1.5)

- Category chip/line icon renders for every `DB_CATS` key, auto and manual, no fallback
  "undefined" icon anywhere.
- Month view's expense breakdown total equals §1's `calcDayBookExpenses(year,month).total`
  exactly — same function, not a re-derivation.
- Trend chart's summed totalIn/totalOut across the visible range equals the sum of each
  underlying day's `dbDayView` totals — no drift between chart and detail.
- A closed (locked) day still renders correctly in Month view and the chart, using its frozen
  closing figure, not a live recompute.
- Export, wipe, restore: Month view and party/photo fields on entries survive round-trip
  identically (extend `checks/roundtrip.js` coverage, don't just eyeball it).
- Two shops on one device: Month view, trend chart and party groupings never cross shops
  (same `shopScopedKey()` discipline as everything else).
