# batch28 — supersedes batch27: Day Book "v2" — expenses reach P&L, categories get
icons/colors, a cash-flow trend chart and a new Month view

Base: batch27 (confirmed live — see HANDOFF.md, 19 Sep entry for the confirmation pattern
Cowork used; check whether it's still current before assuming). Full site zip — everything
since batch27 is in it, including the non-cash visibility fix.

## 🔴 Day Book "v2" — `docs/DAYBOOK-SPEC-v2.md`, §1+§3+§2+§6 of 6

Tanish's complaint after seeing batch27 live: Day Book still "looks cheap and unprofessional
... won't create an impression." Researched six real competitors, traced six concrete gaps
against the actual code, and built four of them (§4 party-linking and §5 photo attachment
are still open — see "Not in this zip" below).

### What changed

- **Expenses now reach Reports.** Day Book's manual expense entries (rent, salary,
  electricity, etc.) used to be invisible to the P&L — Reports stopped at "Gross Profit" and
  never knew Day Book existed. Now every P&L view (Reports' metric tile, the P&L card, the
  6-month chart, the dashboard digest, the WhatsApp daily-summary share, and the emailed/PDF
  Monthly Business Report) shows **Net Profit** — the real number after expenses — instead of
  gross. Owner Drawings and Owner Capital are correctly excluded; they're equity movements,
  not business costs, exactly like a real accountant would treat them.
- **Categories got icons and colors.** Every Day Book category (rent, salary, drawings,
  capital, a girvi/sale/purchase/order auto-line, etc.) now shows a small colored icon in the
  entry-add chips and in the Lines list, instead of plain text. Reuses existing color tokens
  already used in Reports and Girvi — no new palette.
- **A cash-flow trend chart, and a Month view.** Day Book was single-day-only. It now has a
  Day/Month toggle: Month view adds a month picker, a 14-day/30-day bar chart (cash in vs.
  cash out, tap a bar to jump into that day), Cash In/Out/Net tiles for the month, an expense
  breakdown by category, and a day-by-day list with a lock icon on closed days.

### What did NOT change (verified, not assumed)

The locked-day rule, the auto-line derivation (sale/purchase/girvi/order posting), Close Day,
and every existing cash figure — all byte-for-byte identical to batch27. This was reviewed
specifically for that guarantee (see below) before shipping. Nothing here touches
`S.dayBook`'s storage shape; export/restore/roundtrip pass unchanged.

### Caught and fixed before shipping, not after

An independent review of this work (documented in `HANDOFF.md`, 23 Sep) found two real bugs
before this zip existed:
1. A Month-view tile ("Net Cash After Expenses") was double-subtracting expenses that were
   already counted in Cash Out — it could show a loss, in red, in a month that was actually
   profitable. Removed rather than patched; the real Net Profit figure lives in Reports.
2. The emailed/PDF Monthly Business Report had a row labelled "Net Profit" that was still
   showing the gross figure. Now shows the real one.

Both are fixed in this zip, along with three smaller cleanups the same review flagged: Month
view's tiles now say which range they cover, "Profit" means the same number everywhere in
the app (it didn't, before the fix), and a date-comparison in the new expense filter no
longer depends on IST specifically (was correct, but only by luck of the timezone).

## 🟢 Everything from batch27, unchanged

The non-cash visibility fix (UPI/Card/Bank/Cheque sales no longer vanish from Day Book), the
PIN security fix, Adjust Stock, the dead-password-hashing cleanup. See `CHANGES-batch27.md`
and earlier for those in full — none of it was touched again in this batch.

## After you deploy — what to actually check, in priority order

1. **PIN screen** (carried from batch26/27) — still nobody's confirmed this on a real device.
2. **Reports tab** — open the P&L card for the current month. Confirm "= Net Profit" appears
   below "= Gross Profit" and matches the "Operating Expenses" figure subtracted correctly
   (add a rent/expense entry in Day Book first if there isn't one yet, so there's something
   to see). Confirm the top metric tile's "Profit" number matches the P&L card's Net Profit,
   not Gross.
3. **Day Book → Month view.** Tap the new "📅 Month" toggle. Confirm the chart renders, the
   14d/30d toggle works, tapping a bar or a day row jumps into that day's normal view, and a
   closed day shows a lock icon. Confirm the Cash In/Out/Net tiles look sane against what you
   already know about the month's cash.
4. **Day Book category icons** — open "+ Add Entry," confirm each category chip shows an icon
   and colored border, not plain text.
5. Then the rest of batch27's checklist: a normal cash sale, a UPI sale (non-cash banner),
   a girvi payment, an order advance, Adjust Stock.

## Not in this zip

§4 (linking a manual Day Book entry to a person/customer) and §5 (attaching a receipt photo
to a manual entry) from `docs/DAYBOOK-SPEC-v2.md` — both still open, §5 is explicitly gated
on re-checking the backup-size math before any code gets written. The Netlify free-tier badge
and long-shop-name header overlap are also still open, same as every batch since 21 Sep —
neither is an app-code fix.

## Verified before shipping

Regression suite 201/201 (14 new tests across this batch), all eleven files parse
(`node --check`), `loadorder`/`backup-check`/`roundtrip` clean, all nine `checks/` scripts
diffed against their pre-batch baseline with no new findings, zip built with 7-Zip and
byte-verified against this folder. This batch was also independently reviewed end-to-end
before shipping (not just self-checked) — see `HANDOFF.md`, 23 Sep entries, for the full
review and what it caught.

**Not verified:** anything visual or interactive, on any device or in any browser. There is
no browser automation in this project. The chart, the Month view, the category icons, the
Day/Month toggle, and every other DOM-level change in this batch is unverified until someone
actually taps through it on a phone.
