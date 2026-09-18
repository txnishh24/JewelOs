# batch23 — housekeeping, nothing you'll see

Base: batch22 (deployed and re-tested live on 18 Sep). This is a full site zip, so it
contains everything batch22 had as well — dragging it in is safe either way.

**There is nothing to test in this one.** No screen looks different, no number is
calculated differently, no button behaves differently. Skip straight to "After you deploy"
below if you just want the one thing worth checking.

## What changed

Removed 11 old functions (plus an unused chart-drawing helper and a leftover style block)
that nothing in the app calls anymore — mostly earlier versions of features that were later
rewritten elsewhere and left behind instead of deleted. Examples: an old GST-calculation
routine replaced by a newer one months ago, a WhatsApp-reminder message replaced by a
better one, and a handful of dashboard-stat helpers that got swapped for different
calculations without the old ones being cleaned up.

None of this is code the app was running — it's code the app had stopped running and
never removed. Deleting it doesn't change what happens on any screen.

## What was found but NOT touched

Three other pieces of unused-looking code turned out to look more like **half-built
features** than leftovers — a quantity editor with no button wired to it, a Girvi "Archive"
action with no button to trigger it (though "Recover" already works), and a password-check
function that looks superseded by server-side login. None of these were touched; they're
flagged in `HANDOFF.md` for you to decide whether to finish wiring them up or drop them
for good.

## After you deploy — thirty seconds

Open the app, look at Inventory, Girvi, and a bill. Everything should look and behave
exactly as it did before this zip. If anything looks different, that's a bug in this
change and worth reporting immediately — this batch was not supposed to change anything
visible.

## Verified before shipping

Regression suite 113/113 (same as batch22 — this change touches no logic any test
exercises), all files parse, and the zip was extracted and compared file by file against
the source. Paths checked to use `/` separators.

**Not verified:** nothing needing a real phone or a real signed-in session — there's
nothing behavioural in this batch to verify that way.
