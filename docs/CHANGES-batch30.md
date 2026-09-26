# batch30 — supersedes batch29: real duplicate-bill guard, Day Book party link, Sentry monitoring

Base: batch29 (confirmed live). Full site zip — everything since batch29 is in it.

## 🔴 The duplicate-bill guard now actually works, all day

`isDuplicateSale()` was supposed to catch a second, separate save of the same bill within
60 seconds — a cashier double-tapping, or retrying after a slow network. It compared
against the bill's *date*, which is stored as UTC midnight, so the guard only worked in
the first minute after 5:30am IST and silently did nothing the rest of the day.
Sales now carry the real moment they were saved, and the guard checks that instead. The
bill date itself is unchanged and still editable. Independently re-verified end to end
(not just the unit test) — see HANDOFF.md, 26 Sep, Cowork's live-behavior check.

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

## 🟢 Sentry error monitoring

Errors, performance traces, and session replay (with text/media masked, given the
billing data this app handles) now report to Sentry via its CDN Loader Script — no
build step needed for this. Verified end to end against a live Sentry project before
shipping. Invisible to shop users; this only affects what we can see when something
breaks.

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
   free-text entry. Then Day Book → Month → "👤 By Person" — confirm both show up,
   grouped correctly, with the linked customer's phone number visible.
3. Confirm Sentry is receiving events for this deploy (check the Sentry project
   dashboard after using the app for a few minutes).

## Verified before shipping

Regression suite 210/210 (5 new tests this batch: 1 for the duplicate-bill fix, 4 for
the Day Book party link). All eleven files parse (`node --check`), `backup-check`/
`roundtrip`/`making-basis` and every other `checks/` script clean against the previous
run. Cowork independently re-ran both the duplicate-bill guard and the Day Book party
link through the real UI-facing functions (`recordSale()`, `renderDayBook()`) end to
end, not just the isolated unit tests — see HANDOFF.md, 26 Sep.

**Not verified:** anything visual or interactive on an actual phone or browser — there
is no browser automation in this project. The "Duplicate bill?" dialog's look, the
person-link autocomplete dropdown, and the By Person cards are all unverified on a real
screen until someone taps through them.
