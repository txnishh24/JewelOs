# batch55 — 15 Oct UI/UX audit (Phase 1, Phase 2, Phase 3 + 3 bugfixes)

Base: the Cloudflare worker's content as of batch54's 15 Oct deploy (motion pass v2,
already live). This batch changes `index.html` and 9 of the 11 `js/*.js` files on top of
that base (`04-orders-detail.js` and `05-auth-login.js` are untouched). `sw.js` is
untouched too — see "sw.js" below for why that's safe. Commits: `18d2719`, `43fc399`,
`efb6423`.

## ✨ What changed

Three commits implementing all three phases of Tanish's 15 Oct live-app UI/UX audit,
presentation-only throughout — no calculation, girvi/ledger, save/sync, counter,
storage-key, auth, or `supabase/` change anywhere in this batch.

**Phase 1 (`18d2719`):** money-numeral font (Inter + tabular-nums on amount/weight/count
values, not headings); risky-button relocation (header Sign Out moved into
Settings→Account; Demo/Clear moved to a Data-tab "Danger zone"; Stock row actions
collapsed into a "⋯" overflow menu; Girvi "Mark Default" separated from "Release Item");
Dashboard onboarding checklist collapsed to a tap-to-expand row; Stock gold-rate editor
collapsed to a one-line summary with scrolling category chips; mobile header
labels/aria-labels and non-truncating shop name; login logo swapped from emoji to the
header's SVG emblem; smaller fixes across Girvi/Orders/Customers/Day Book/Settings/the
Girvi wizard.

**Phase 2 (`43fc399`):** Sale screen — sticky Grand Total + Record bar (mirrors the
existing summary's own rendered total, never recalculates it), Clear demoted to a small
secondary link, Charges & Adjustments/Old Gold-Exchange/Advance Already Paid/Notes made
collapsible (auto-opens on a non-zero value), full-width SKU box on phones.

**Phase 3 (`43fc399`):** Girvi detail modal (sticky header, "More actions", Escape-to-
close, plus a root-cause fix for the Ledger's dead fade-in and a duplicate-button bug
found while rebuilding it); Purchase History/Supplier Ledger stacked cards under 600px;
Add Product single column under 420px; Reports sections made collapsible; one
inline-SVG icon set replacing UI emoji (`ICONS`/`svgIcon()`, `js/01-sync-core.js`); 1440px
desktop layout (2-column Sale, dashboard tile fix); "Record Sale"→"Sale" naming cleanup.

**Bugfixes (`efb6423`), found by Tanish browser-testing `43fc399`:**
1. The shared numeral font-family rule was losing a CSS specificity tie (declared before
   the four selectors it targets, so their own later rules always won) — moved it after
   all four.
2. The product actions sheet (`openProdActionMenu`) had nothing closing it on Escape or
   on tab/sub-tab switch — added both.
3. `loadDemoData()` seeded an order with `status:'making'`, not a real `ORD_STATUS` key,
   so `renderOrders()` threw and broke Orders after Load Demo Data. Demo data now uses
   `'progress'`; added a fallback-to-`'new'` lookup (`ordStatusOf()`) for any unrecognized
   status, plus a regression test.

## 🔍 How this was checked

`check.bat` clean on the final state (`efb6423`): syntax OK on all 11 files, regression
suite **423/423**, backup-check and roundtrip both **PASS**, AST/scope checks (step 3)
identical to the pre-batch known-false-positive baseline — no new globals, no new dead
references, no new unstyled classes.

**Not a real phone or real browser.** All three commits were verified by code reading,
`check.bat`, and (for the bugfixes) Tanish's own browser test against a prior build —
not a phone pass against this deployed build. See HANDOFF.md's 31st/32nd entries for the
full per-screen phone-test list this still wants once live: Sale screen, Girvi detail
modal + Ledger, Purchase History/Supplier Ledger cards, Add Product, Reports, every icon
location, Dashboard at 1440px, plus re-checking the two just-fixed bugs (numeral font
computed style, actions-sheet closing on Escape/tab-switch).

## sw.js — intentionally untouched

`sw.js` (`jewelos-v20`) is unchanged by this batch and is network-first — its fetch
handler always tries the network first and only falls back to cache on failure,
overwriting the cached copy on every successful 200. An already-installed device picks
up this batch's new `index.html`/`js/*` the next time it's online; no stale-shell risk,
no cache-name bump needed.

## Not in this batch

Server-side: no `auth-gateway`/`store-proxy`/`razorpay-webhook` change, no migration, no
Supabase write of any kind. `jewelos.co` / `ALLOWED_ORIGINS` is unrelated and untouched.
