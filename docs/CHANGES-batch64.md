# batch64 — Karigars tab, metal-issued tracking, karigar profile, optional wastage-kept

Base: the Cloudflare Worker's content as of batch63's deploy (`6a74db4`). Everything in this
batch is karigar work. No Edge Function change, no schema change, no new top-level shop-data
key (every new field is nested inside `orders[].items[].karigarStages` or `karigars[]`), so
the backup/restore round trip is unchanged. The service worker is network-first, so phones
pick up the new files without a cache-version bump.

## What jewellers will see

- **Karigars is now its own tab** (More menu on phones, side menu on desktop; hidden from
  staff logins like Girvi and Settings). It used to be a card inside Settings.
- **"Assign to Karigar" button** in an order's Order Items header: one set of prompts gives
  the same karigar, task and pay (cash ₹ per piece, or wastage %) to every item that has no
  karigar working on it. Items already with a karigar are skipped. The button is hidden on
  cancelled, delivered and billed orders.
- **Metal handed over.** At assign time, or later with **Issue Metal** on an item, record the
  grams and purity given to the karigar (top-ups allowed; a typo can be corrected with a
  negative number behind a warning). The order form also has a "Metal issued now" box per stage.
- **Weigh-in on Mark Submitted.** If metal was issued, submitting asks for the weight received
  back (and leftover metal returned) and compares it to what was issued, across purities
  (24K out, 22K piece back). Result: matches / within wastage allowance / short / over. A
  shortfall beyond allowance asks for confirmation and an optional note, then is recorded in
  red on the order. Stages with no metal issued submit exactly as before.
- **Karigar card:** editable name, phone, skills and note; "Holding now" (fine grams of gold
  and silver currently with the karigar); average turnaround; metal short beyond allowance.
- **Wastage kept (optional, per stage).** A tick-box in the order form (and the `wastage` /
  `wastage-paid` choice when assigning): when ticked, the karigar keeps the wastage out of
  the metal issued, so nothing is owed to him for it. Untick it if you pay wastage separately.
  New stages default to ticked. Stages created before this batch are unchanged.

## Bugs fixed on the way

- **Karigar stages typed in the order form were never saved.** `saveOrder()` dropped them.
- **"Owed" counted a billed order twice** (the order and its bill copy), and a copy still
  waiting on the bill stayed in the queue forever. Karigar views now read from orders only.
  If you saved a bill after leaving the Sale tab mid-conversion, the bill carried the copies
  too; the carried copies are now dropped when you leave the tab.
- **New input checks:** negative or huge cash amounts, wastage of 100% or more, issued metal
  on a plated item, and a cleared karigar name (which used to create a nameless karigar) are
  refused or ignored with a message. Typing `24` for purity now means 24K.
- **Phone layout:** the Task and Karigar-name boxes in the order form no longer shrink to
  nothing on a 375px-wide screen.

## What changes for existing data

Data check on 30 Oct (Cowork, read-only): the only shop with a billed order carrying a
submitted stage is the E2E test shop, and no sale carries stages that an order does not
account for. No real shop had karigar data, so no live "Owed" figure moves.

## Rollback

The live site before this batch is batch63, built from commit `6a74db4` (tagged `batch63-live`). To go back: `npx wrangler rollback`, or `git checkout batch63-live`, run `node build-cf-deploy-stage.js batch63`, then `npx wrangler deploy`. Going back does not erase the new metal-issued fields (batch63 only creates orders, it never rewrites them); batch63 would again double-count billed orders in karigar Owed.

## Not covered / known gaps

- A receipt weight typed wrongly cannot be edited afterwards.
- A wastage entry like 40% is accepted without a warning.
- If another phone bills the same order while this one is offline, the replayed bill is
  saved but not linked to the order.
- Not tested on a real phone; layout was checked in a browser at 375px width.
