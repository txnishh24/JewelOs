# batch62 — fix `toggleStatus()` losing a multi-piece item's real quantity on a sold↔available round trip

Base: the Cloudflare Worker's content as of batch61's deploy (`354280f`, 24 Oct, Version
ID `701dc139-7f2d-4a39-a08c-8d9a58657b5c`). One substantive commit since:

- `f126f36` — Fix `toggleStatus()` losing a multi-piece item's real quantity on a
  sold→available round trip

## ✨ What changed

**Confirmed live data-loss bug, found during a live test of batch61** (88th-91st HANDOFF
entries): `toggleStatus()` (`js/02-ui-inactivity-modals.js`) hardcoded a product's
quantity to `0` when marked sold and `1` when restored to available, regardless of how
many pieces it actually had. A real shop's 2-piece item ("Lion ring", SKU C001) toggled
sold then back and came back as 1 piece — the second piece was silently gone, confirmed
against the live Supabase record and its stock-movement log.

Fixed: the function now remembers the quantity a product had when marked sold
(`p._qtyBeforeSold`) and restores that exact number on the way back to available, instead
of a hardcoded `1`. It also now recomputes `weight = unitWeight*qty` on both transitions —
it never touched weight at all before, a second latent inconsistency on any multi-piece
item. The save-failure rollback path restores the exact previous quantity too, not an
inferred one.

Pricing itself was never wrong — New Sale bills a stock item correctly on `unitWeight`;
this was a pure stock-count bug in the toggle, unrelated to billing math.

## Not in this batch

Nothing else — `js/02-ui-inactivity-modals.js` is the only file this batch touches (plus
`HANDOFF.md`, not a served asset). The security-hardening config commit (`8cdf783`) and
the HANDOFF-only commits before this one touch no `js/`/`index.html` files, so there is
nothing else for this Worker deploy to pick up.

## 🔍 How this was checked

`node --check js/02-ui-inactivity-modals.js` clean. Full regression suite: 433/433
(same as the batch61 baseline). All 9 `checks/*.js` AST scripts run individually
(`check.bat`'s own `pause` doesn't run well non-interactively) — same hits as the
documented baseline, nothing new; `backup-check` and `roundtrip` both clean.

Byte-exact edit note: this file has `\uXXXX`/UTF-8 escapes near the touched function —
used a one-off Python read-modify-write script (deleted after running), per house rule,
instead of a string-replace tool.

## Not verified against a live screen this session

The actual Inventory screen's "mark sold" / "restore to available" buttons were not
clicked through in a real browser against this fix before deploy — only the regression
suite and AST checks, which don't exercise DOM behaviour. `jewelos-deploy-verifier` runs
immediately after this deploy to confirm the live origin serves the fix; Cowork is asked
to click through the actual toggle live afterward (2-piece item, sold→available, confirm
it comes back as 2) before C001 itself is manually corrected.
