# batch54 — CSS-first motion pass (press feedback, list stagger, modal easing, reduced-motion)

Base: the Cloudflare worker's content as of batch53's 15 Oct deploy (CORS allowlist on
auth-gateway v8/store-proxy v10, sw.js jewelos-v20, already live). This batch changes
`index.html` and three of the eleven `js/*.js` files on top of that base. `sw.js` is
untouched — see "sw.js" below for why that's safe.

## ✨ What changed

Four small, deliberately scoped additions to the app's existing motion system (the
`prefers-reduced-motion` block, `.modal`/`.gl-wrap` open transitions, and the handful of
`@keyframes` already in `index.html` before this batch):

1. **Press feedback.** `.btn:active` and `.bnav-btn:active` now scale to `.97` over 80ms —
   every button variant in the app's one shared button system, plus the bottom nav. The
   Customers list row (the one list row that's a tap target as a whole) gets the same
   treatment via a new `.cust-row-card` class.
2. **List entrance stagger.** Rows on Inventory, the Reports "Sales in &lt;month&gt;" bills
   table, and Customers fade up (opacity + 6px translateY, 220ms) with a per-row delay
   capped at 6 rows, on the first render of that list only — switching tabs, not the 15s
   auto-refresh, not typing in a search/filter box, not paging. Verified directly: calling
   the render function the way auto-refresh/filter does (no entrance flag) produces rows
   with no stagger class at all.
3. **Modal/bottom-sheet open/close.** Both now use the app's existing `--ease-out` curve
   (`cubic-bezier(.23,1,.32,1)`) at an asymmetric duration — 220ms opening, 150ms closing —
   instead of the old symmetric 200ms both ways. No new curve, no overshoot.
4. **Reduced motion.** The existing `prefers-reduced-motion` block now also zeroes the
   stagger's per-row delay (duration was already handled by its existing blanket rule, the
   delay wasn't) and turns the new press-feedback scale off. Opacity fades stay, same
   principle as the carve-out already in that block for modals/sheets.

**Deliberately not in this batch:** no dashboard number animates — every dashboard figure
renders exactly as before, same formatter, same call path, nothing new computed or
tweened. No save/sync/invoice-numbering/money logic touched anywhere. No dependency
added.

## 🔍 How this was checked

`check.bat` clean: syntax OK on all 11 files, regression suite 422/422, backup-check and
roundtrip both PASS, AST/scope checks (step 3) identical to the pre-batch baseline — no
new globals, no new dead references, no new unstyled classes. Screenshots at 375px and
1440px (dashboard, inventory table + cards, customers, bills/reports, an open bottom
sheet) via Playwright against a local static copy with demo data loaded, plus a separate
pass with reduced-motion emulated and re-checked by computed style (`animation-delay:0s`,
`transform:none`, modal `transition-property:opacity` only).

**Not a real phone.** The screenshots above are a local static server, not this live
Cloudflare worker, and not a real device. See HANDOFF.md for the phone-test checklist
this deploy still wants once it's live.

## sw.js — intentionally untouched

`sw.js` (`jewelos-v20`, unchanged by this batch) is network-first: its fetch handler
always tries the network first and only falls back to the cache on failure, overwriting
the cached copy under the same `CACHE` name on every successful 200 response. That means
an already-installed device gets this batch's new `index.html`/`js/*` the next time it's
online, with no stale-shell risk — bumping the cache name is only needed when the
*fetch strategy itself* is cache-first, which this one isn't. (The `install`-event
precache that *is* cache-first only re-runs when `sw.js`'s own bytes change, which they
don't here.)

## Not in this batch

Server-side: no `auth-gateway`/`store-proxy`/`razorpay-webhook` change, no migration, no
Supabase write of any kind.
