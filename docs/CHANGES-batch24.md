# batch24 — Girvi entries can now be archived

Base: batch23 (dead-code cleanup, deployed live). This is a full site zip, so it contains
everything batch23 had as well — dragging it in is safe either way.

One small, visible change. No money, interest or ledger math touched.

---

## Girvi cards now have an "Archive" button

**Before:** the Archived tab already had a working "↺ Recover" button, but there was no way
to actually get a loan *into* that tab. If you created a Girvi entry by mistake, or want it
off your active list without deleting the real record, there was nothing to press.

**Now:** every active Girvi card (Call / WhatsApp / Pay / Edit / Ledger row) has a sixth
button — **📦 Archive**. Tap it, confirm, and the entry moves to the Archived tab. Nothing
is deleted — the full record, ledger and audit trail stay intact, and "↺ Recover" brings it
straight back to active if you archived the wrong one.

A closed (fully repaid) loan cannot be archived — same rule as before, just now enforced
through a real button instead of being unreachable code.

## What is NOT in this zip

- **Nothing server-side.** No Supabase change.
- **No change to how quantity is edited on a product.** A related gap was found during the
  code review that led to this batch (an "adjust stock quantity" feature exists in the code
  but has no button anywhere), but it needs a decision on *where* that control should live
  before it's built — not shipped here.
- Same standing items as prior batches: password reset still off until `RESEND_API_KEY` is
  set, and the "Free forever" sign-up wording still needs your call.

## After you deploy — one minute

1. Open Girvi, pick any active (not closed) loan.
2. Tap **📦 Archive** → confirm.
3. It should disappear from the active list and appear under the **Archived** filter with a
   "↺ Recover" button.
4. Tap Recover — it should come back to active, unchanged (same balance, same history).
5. Confirm a **closed** loan does not show the Archive button.

## Verified before shipping

Regression suite 113/113, all ten files parse, zip extracted and byte-compared against the
source, paths use `/` separators. The button's markup and the function it calls
(`deleteGirviEntry`, which already had test coverage and has been in the codebase since
Sept 18) were checked by hand.

**Not verified:** nobody has tapped this button on a real phone yet. This is a DOM/onclick
change with no browser automation in this project — Cowork is doing the live pass after
you deploy.
