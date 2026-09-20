# Day Book (Rojmel) — design spec

Status: proposal, 20 Sep 2026. Risk class: 🔴 (financial records). No code written.
Destination: `Desktop\jewelos\docs\DAYBOOK-SPEC.md`. HANDOFF entry is separate.

## 1. Why

Rojmel is the daily cash book Indian jewellers keep by hand. JewelOS has no day book and no expense tracking, so a shop keeps its paper rojmel next to the app, and the P&L shows gross metal margin only, not net profit.

Tanish's read: nearly every jeweller expects a rojmel. That is NOT yet validated with a real shop. Ask in the first demos: "What do you write in your rojmel every day?"

## 2. Reference: what Prime does

Source: Prime Software Solution's own IndiaMart listing for its rojmel product, plus Techjockey. We have not seen the software or its screens — it is closed, Windows-desktop software. We copy the workflow, not code or UI.

- Entry is meant to feel like writing the rojmel by hand. Single or double entry.
- After every transaction the screen shows running gross stock and cash balance.
- Separate cash book and gold book (gold tracked by weight).
- Rojmel entries post automatically to ledgers. Direct ledger adjustment is also possible.
- Bhav-cut: settle gold weight against cash at an agreed rate.
- T-format ledger printing. Balance carry-forward for any ledger.
- Karigar fine balance and net weight, tracked separately.
- Account groups: daily shop expenses, Vyapari Khata, Zangad, Udhar, Advance, Money lending, Karigar, Gold sale/purchase.
- Year-end closing on April–March or Diwali–Diwali.
- Print preview, automatic end-of-day backup. No mobile app.

## 3. Scope by phase

**Phase 1 — Cash day book (build this first)**
1. Day Book tab: pick a date, see opening balance, every cash-in and cash-out line for the day, running balance, closing balance.
2. Auto lines, read-only, generated from records JewelOS already holds: cash from sales, cash paid on purchase bills, girvi loans given (out) and girvi repayments received (in), order advances (in), refunds (out).
3. Manual lines: expenses (rent, salary, electricity, tea, etc.), owner drawings, owner capital, bank deposit/withdrawal (a transfer between cash and bank, not income or expense).
4. Close Day: owner types the physical cash counted; app shows short/excess against closing.
5. Print/PDF in two-column rojmel layout. WhatsApp share of the day summary (click-to-chat already exists).
6. Expenses flow into Reports so P&L becomes net profit.

**Phase 2 — Gold book (only when a real shop asks)**
Fine-weight in/out from purchases, sales, old-gold exchange. Separate from the cash book.

**Phase 3 — Party ledger / karigar (only when a real shop asks)**
Customer and supplier running balance, T-format print. Karigar issue/receipt and fine balance. Bhav-cut.

**Not doing**
- No clone of Prime's UI or code.
- No full double-entry accounting.
- No change to GST export.
- Do NOT touch `girviLedgerState`. Read from it; build additive views on top.

## 4. Data model (proposal — Opus to confirm or replace)

Auto lines are derived at read time from existing records. Only manual lines and day-close records are stored.

```
S.dayBook = {
  opening:  { date: 'YYYY-MM-DD', amount },     // first day only, owner-entered
  entries:  [ { id, date, dir: 'in'|'out', amount, cat, note, ts,
                voided: false, voidReason: '' } ],
  closes:   [ { date, closing, counted, ts } ]   // one per closed day
}
```

- Dates are local calendar days (same rule as `paidUntil`).
- Manual lines are never hard-deleted. A wrong line is voided with a reason; the void is visible.
- Follow whatever amount and rounding convention the girvi and billing code already use. No float drift.
- Every stored action also writes to the broad activity log (`saasActivityLog`).

## 5. Posting rules (auto lines)

| Event | Cash effect |
|---|---|
| Sale, cash portion | in, on bill date |
| Sale, UPI/card/bank portion | NOT cash. Excluded from cash closing |
| Purchase bill paid in cash | out |
| Girvi loan disbursed in cash | out |
| Girvi repayment received in cash | in |
| Order advance received in cash | in |
| Refund or return paid in cash | out |
| Bank deposit / withdrawal | transfer, no income or expense |

## 6. The main design risk: history moving

If auto lines are always recomputed, editing an old bill silently changes an old day's closing. A paper rojmel cannot do that.

Proposed fix: **Close Day locks the day.** The closing figure is stored. A later correction to a past record shows up as a visible adjustment line on the current day, not a rewrite of the past. Days that were never closed stay live.

Opus must decide this before any UI work.

## 7. Phase 1 screens (mobile-first, ES5, old-Android safe)

- Top: date picker with previous/next day.
- Opening balance card, then the in/out list with running balance, then closing balance card.
- Buttons: Add Entry (In / Out toggle, category chips, amount, note), Close Day, Print/PDF, WhatsApp summary.
- Locked days show a lock icon and no edit controls.

## 8. Why this beats Prime

- Bills, purchases and girvi post automatically. Prime users re-type them.
- Works on a phone, offline, no install.
- Cash count at close shows short/excess. Prime's description does not mention this.
- Void-with-reason instead of silent deletes, plus an activity log.
- WhatsApp daily summary to the owner.
- Included in export, restore and the round-trip check, so it survives backup.

## 9. Codebase constraints (from working notes)

- ES5 only. New numbered module in `js/`, loaded in order. Grep before assuming where a helper lives.
- Shop state is one JSON blob. Store only manual entries and closes, or the blob grows every day. Rough estimate: 10 manual entries a day is a few hundred KB a year.
- Any localStorage key holding shop state MUST use `shopScopedKey()`. The regression suite scans for violations.
- New state keys must be added to export AND restore. Run `backup-check.js` and `roundtrip.js`. A past backup saved 12 keys and restored 10.
- Add tests to the real `tests/regression.test.js`, not to a copy.
- Edits near `\uXXXX` escapes: use the Python byte-exact read-modify-write approach.
- Run `check.bat` before any deploy. Verify the live origin after the Netlify drag.
- Model policy: 🔴. Opus plans the data model and posting rules, Sonnet implements, Opus reviews before deploy.

## 10. Verify first (I cannot see the code) — ANSWERED 20 Sep, see HANDOFF entry

Answers found by reading the real code (`js/01-sync-core.js`, `04-orders-detail.js`,
`06-inventory-stock.js`, `07-settings-plans.js`, `08-girvi-viewmode.js`, `09-purchases.js`) —
full detail in the 20 Sep Cowork HANDOFF entry below this spec's own entry. Short version:

1. Payment mode is already captured almost everywhere — sales (including split payments across
   modes), purchases (one mode per bill, "Credit" is a valid option meaning zero cash), girvi
   (per disbursement and per repayment), order advances. **Not a blocking prerequisite.** One
   real gap: purchases don't support split payment across multiple modes the way sales do — a
   bill is Cash *or* UPI *or* ... *or* Credit, never split. Fine for Phase 1 (day book only
   needs the one mode a bill actually used).
2. Old-gold exchange (`sale.oldGold.value`) is a deduction against the sale total, not a
   separate cash movement — no extra day-book line needed for it, it just changes how much
   cash the sale actually generates. Returns/refunds live in `sale.refunds[]`
   (`refundStatus`: full/partial) plus `sale.returnedItemIdx` for physically-returned stock.
   Not yet confirmed: whether each refund entry carries its own payment mode — check before
   wiring the "Refund" row in §5's posting table.
3. Order advances confirmed on `order.ledger[]` / `nowPaying` / `prevAdvance`, each with a
   `mode` and a `date`.
4. Part-payment / udhar is already modeled through `payStatus` ('partial'/'full'),
   `splitRows` at sale time, and `extraPayments[]` for cash collected later against an
   already-made sale — build day-book auto-lines from these individual payment *events*, not
   from the sale's total value, which matches this spec's intent already.

## 11. Acceptance tests

- Closing = opening + in − out, exact.
- Closing of day N = opening of day N+1.
- A day with no entries still shows carried-forward balance.
- A UPI-only sale does not change cash closing.
- Voiding a manual line leaves a visible void, and totals reflect it.
- A closed day's closing does not change when an old bill is later edited; the change appears as an adjustment on the current day.
- Export, wipe, restore: day book identical.
- Two shops on one device never see each other's day book.
- Print/PDF total equals on-screen total.

## 12. Decisions for Tanish

1. Labels: Jama/Udhar or In/Out? Usage differs by community, so check with 2-3 real jewellers. Default to plain In/Out with Jama/Udhar as the printed headers only if they confirm.
2. After a subscription lapses (read-only), should day-book entries be blocked? Recommendation: no. It is the jeweller's own book, consistent with backup never being blocked. But it adds a fourth blocked action to a rule you set, so it is your call.
3. Financial year: April–March default. Diwali–Diwali later only if asked.

## 13. Competitor note

JewelBooks (jewelbooks.in) advertises cloud jewellery accounting with a day book, Gold and Silver URD, karigar settlement, UPI and split payments, HUID, WhatsApp-ready invoices and Tally XML import/export. It is not in the existing competitor notes and is a cloud product, which weakens any "only desktop competitors" claim. Needs its own research pass.
