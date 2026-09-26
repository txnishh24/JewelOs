# batch31 — supersedes batch30 (never deployed): same content, plus 4 review fixes

Base: batch29 (confirmed live). batch30 was built but not confirmed deployed before two
review passes (one Sonnet, one Opus) found and fixed four more bugs in its own changes —
this zip carries everything batch30 would have, with those four fixes included. If
batch30 was already deployed, treat this as its immediate follow-up; if not, deploy this
one instead and skip batch30's zip entirely.

## 🔴 The duplicate-bill guard now actually works, all day

`isDuplicateSale()` was supposed to catch a second, separate save of the same bill within
60 seconds — a cashier double-tapping, or retrying after a slow network. It compared
against the bill's *date*, which is stored as UTC midnight, so the guard only worked in
the first minute after 5:30am IST and silently did nothing the rest of the day.
Sales now carry the real moment they were saved, and the guard checks that instead. The
bill date itself is unchanged and still editable. Independently re-verified end to end
(not just the unit test) — see HANDOFF.md, 26 Sep, Cowork's live-behavior check.

A follow-up review caught a second bug in this same guard: it relied on a malformed
timestamp's comparison failing to look "recent," but that comparison is always false in
JavaScript regardless of the timestamp's age, so a bad timestamp would have fallen
through as if it were fresh instead of being safely skipped. Not reachable by anything
that creates a sale today, but fixed defensively (`isNaN()` is now checked explicitly).

## 🔴 Day Book: link a manual entry to a person

Rent, salary, and other manual Day Book entries can now optionally be linked to a
customer (or a free-text name/phone for someone not in Customers, like a landlord).
Linked entries show a small tag in the day's line list. A new "👤 By Person" view in
Month view groups the month's linked entries by person, the same way Girvi's "By
Customer" view already works. Nothing about how cash totals or closed days are
calculated changed — this only affects what a manual entry can additionally carry and
how it's displayed. Receipt/photo attachment (the other half of this spec section) was
investigated and deliberately not built: it would grow a shop's single data row by an
estimated 20–35MB/year, well past its ~3MB practical ceiling. Tanish decided to skip it
for now rather than build it against Supabase Storage.

Two follow-up fixes to this same feature: typing a phone number into the "Link to a
person" field (instead of picking a suggested customer) was being stored as if it were a
name — fixed so it's recognised and stored as a phone number instead. That fix was
initially too narrow (it let a non-Latin name typed alongside a phone number, e.g. a
name in Devanagari, get swallowed into the phone field and lose the name) — tightened so
only text made entirely of phone-like characters counts as a phone number.

## 🟢 Sentry error monitoring

Errors, performance traces, and session replay (with text/media masked, given the
billing data this app handles) now report to Sentry via its CDN Loader Script — no
build step needed for this. Verified end to end against a live Sentry project before
shipping. Invisible to shop users; this only affects what we can see when something
breaks. Not independently re-verifiable from source: replay masking relies on the
SDK's own defaults, which should be on but weren't overridden anywhere to check against
— worth a look at an actual captured replay in the Sentry dashboard to confirm customer
names/amounts show up masked, not in the clear.

## Investigated, not fixed — flagged for a future batch

The 68 orphan invoice numbers and 10 orphan girvi numbers under one shop with no live
data row were investigated (read-only, no code or data touched). Three places in the
code can spend a real, permanent counter number just by opening a screen — no save
required: opening the Sales tab, opening a blank Purchase Bill form, and opening a
Girvi renewal modal. The likely actual mechanism for this specific shop: creating a new
girvi loan doesn't roll back its already-spent counter number if the save fails,
unlike sale creation and girvi renewal, which both do. See HANDOFF.md, 26 Sep, for the
full writeup and exact file/line references. Nothing here fixes it — it needs a
database-side check first to confirm the theory before spending a fix on it.

## After you deploy — what to actually check, in priority order

1. **Sales tab** — create a bill for a customer, then within a minute create another
   for the same customer with the same number of items. A "Duplicate bill?" prompt
   should appear (it wouldn't have, on the old code, unless it happened to be just
   after midnight UTC / 5:30am IST).
2. **Day Book → Add Entry** — the new "Link to a person (optional)" field: type a
   saved customer's name and confirm it suggests them; save one linked and one
   free-text entry, and one where you type a phone number directly — confirm it lands
   as a phone, not a name. Then Day Book → Month → "👤 By Person" — confirm all show
   up, grouped correctly, with the linked customer's phone number visible.
3. Confirm Sentry is receiving events for this deploy (check the Sentry project
   dashboard after using the app for a few minutes), and that a captured session
   replay shows customer names/amounts masked out, not in the clear.

## Verified before shipping

Regression suite 214/214 (9 new tests across batch30 and this follow-up pass). All
eleven files parse (`node --check`), `backup-check`/`roundtrip`/`making-basis` and every
other `checks/` script clean against the previous run. Cowork independently re-ran both
the duplicate-bill guard and the Day Book party link through the real UI-facing
functions (`recordSale()`, `renderDayBook()`) end to end, not just the isolated unit
tests, then that same live-behavior check was re-run again after this batch's fixes —
see HANDOFF.md, 26 Sep, for both passes. Two separate review passes (Sonnet, then Opus)
went over every changed function's callers across the whole diff since batch29.

**Not verified:** anything visual or interactive on an actual phone or browser — there
is no browser automation in this project. The "Duplicate bill?" dialog's look, the
person-link autocomplete dropdown, and the By Person cards are all unverified on a real
screen until someone taps through them.
