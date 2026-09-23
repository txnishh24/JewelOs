# batch29 — supersedes batch28: two 🔴 profit-figure fixes, a stored-XSS security fix,
and a batch of display-only cleanups

Base: batch28 (confirmed live — see HANDOFF.md, 23 Sep entries for the confirmation
pattern Cowork used). Full site zip — everything since batch28 is in it, including a
security fix found and closed the same day.

## 🔴 Two profit-figure fixes (both Opus-reviewed and GO before shipping)

1. **All-time profit now includes girvi interest**, the same way the monthly figure
   already did. Before this, `calcAllTimeProfit()` summed sales only, so the all-time
   number could read *lower* than a single month that had girvi interest in it — caught
   live on a real shop (all-time ₹39,117 vs. one month's ₹73,791).
2. **Month view no longer counts days before your Day Book's opening date.** If you
   started the Day Book partway through a month, the trend chart, the Cash In/Out/Net
   tiles, and the Days list used to start from the 1st anyway — double-counting flows
   already folded into the opening balance, and making the shop's first partial month
   show nonsensical early-day closings (e.g. a day showing −₹15,000 for no real reason).
   Now clipped to `max(month start, your opening date)`, with a small "Day Book started
   &lt;date&gt;" note so it's clear why the range is shorter than the full month.

## 🔴 Security fix — stored XSS via customer name

A customer name built into an inline click-handler using the wrong escaping function
could run arbitrary JavaScript in whoever's browser opened the customer list or used
sale-entry autocomplete — in practice, the shop owner's browser, since any staff account
can create a sale/customer record. Found in a full security audit, fixed the same day,
independently reviewed. No customer data was exposed by this — it's fixed before any
report of it being used. Two new automated tests make sure this specific mistake can't
silently come back.

## 🟢 Display-only cleanups, not risk-gated

- **Money figures with a minus sign now read correctly** — `−₹15,000` instead of the
  confusing `₹-15,000`, everywhere in the app (one shared fix).
- **The monthly PDF report and its All-Time summary** now show Gross Profit, Operating
  Expenses, and Net Profit as three separate lines that actually add up, with Net Profit
  in red when a month or the whole account is running at a loss instead of always green.
- **The WhatsApp daily digest's profit line** now pairs the profit figure with the
  matching margin percentage (they used to be mismatched — a net figure shown next to a
  gross percentage).
- **Day Book's cash-flow chart** can now show a full 14 or 30 days even early in a month,
  reaching back into the previous month instead of being stuck showing only "days so far
  this month." Bars now carry a small date label.
- **Day view's date row** (‹ date › Today) no longer wraps onto two lines on a wider
  screen.
- **A warning banner appears when a day's closing cash goes negative** — this almost
  always means an opening balance or a payment mode was entered wrong.
- **The lock screen's "Forgot PIN" button** is no longer covered by the Netlify free-tier
  badge on a phone-width screen.

## Investigated, not fixed — flagged for a future batch

Two identical `INV-027` sale records were found in one shop's live data (a genuine
double-submit, not caused by anything in this batch). Investigated why the duplicate-bill
guard didn't catch it: it compares against a 60-second-old timestamp using the bill's
*date*, not when it was actually saved — so it only works in the first minute after
UTC midnight (about 5:30am IST), not during normal business hours. Nothing here touches
that logic yet; it needs its own reviewed fix, not a bundled patch. No data was changed.

## After you deploy — what to actually check, in priority order

1. **Reports tab, All-Time summary** — confirm the all-time profit figure is no longer
   lower than a recent month's figure for a shop with active girvi loans (this was the
   🔴 bug: interest income was missing from the all-time total).
2. **Day Book → Month view**, on a shop where the Day Book opening date is after the 1st
   of some month — confirm the trend chart, tiles and Days list start at the opening
   date, not the 1st, and show the "Day Book started..." note.
3. **Sale-entry customer autocomplete and Customers tab → Remind button** — the actual
   surfaces the XSS fix touched. No special check needed beyond confirming both still
   work normally (autocomplete still fills the name/phone, Remind still opens WhatsApp);
   the fix is invisible when nothing hostile is typed.
4. Monthly PDF report and the WhatsApp daily digest — confirm the profit/margin numbers
   read sensibly (Gross/Net split on the PDF, matching profit+margin on the digest).
5. Day Book → a day with negative closing cash — confirm the new warning banner shows,
   and that money figures with a minus sign read `−₹N` not `₹-N` anywhere you spot one.

## Verified before shipping

Regression suite 205/205 (7 new tests across this batch). All eleven files parse
(`node --check`), `backup-check`/`roundtrip`/`making-basis` and every other `checks/`
script clean against the pre-batch baseline. Both 🔴 items (the two profit fixes) and the
security fix were each independently reviewed before shipping, not just self-checked —
see `HANDOFF.md`, 23 Sep entries, for the full reviews and what they checked.

**Not verified:** anything visual or interactive, on any device or in any browser — there
is no browser automation in this project. The chart date labels, the one-row date nav,
the negative-cash warning, the lock-screen padding, and every other DOM-level change in
this batch is unverified until someone actually taps through it on a phone.
