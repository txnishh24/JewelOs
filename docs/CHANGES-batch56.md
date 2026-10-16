# batch56 — final polish pass on the 15 Oct UI/UX audit

Base: the Cloudflare worker's content as of batch55's 16 Oct deploy. This batch changes
`index.html` and all 11 `js/*.js` files on top of that base. Commit: `23ee2a3`.

## ✨ What changed

Presentation only throughout — no calculation, girvi/ledger, save/sync, counter,
storage-key, auth, or `supabase/` change anywhere in this batch.

**Sticky Sale bar** (`js/02-ui-inactivity-modals.js`, `index.html`): `#sale-sticky-total`
now shows "To Collect ₹X" — copied verbatim from `#s-still-pending`'s already-rendered
text (or `fmt(0)` on the fully-cleared path), never a second computation — with Grand
Total demoted to a small "Total ₹Y" aside, once old gold, a previous advance, or a
payment amount puts a deduction in play. Unchanged default (Grand Total alone) when
nothing is deducted.

**Emoji → `svgIcon()`:** swept every remaining emoji in section titles, buttons, tabs,
modal titles and card headers across `index.html` and all 11 `js/*.js` files — both
literal UTF-8 emoji and ones encoded as `&#NNNNN;` HTML entities (batch55's own
emoji-count script only caught literal characters; a second pass catching entities too
found the Stock/Purchases/Gold/Silver tab instances that had been missed entirely).
Added 6 icons to `ICONS` in `js/01-sync-core.js` (`eye`, `offline`, `search`, `save`,
`camera`, `zap`) and a `.ic{vertical-align:-3px;flex-shrink:0;}` CSS rule; every other
conversion reuses the existing set. Left as emoji on purpose: toasts and data-dependent
status banners (save-error, subscription-expired); the actual WhatsApp/receipt/print
message text; `<option>` dropdown items (can't hold an SVG); placeholder text; per-row
badges rendered in a loop over business data (customer-list "Edit" buttons, Girvi
timeline icons, risk/insight/day-book-category icons, the 9-icon ornament-type picker);
and the app's existing `⬇`/`⬆`/`✕`/`✓`/`⚠` plain-symbol convention (only converted
`⚠`/`✅`-style ones sitting in a static button/header, never in a toast). Three
full-screen decorative brand icons (onboarding splash, PIN-screen logo, loading
spinner) were left alone — they carry their own glow/spin CSS, a different visual
system from the inline line icons. Counts (literal + decoded entities, filtered by the
real Unicode `Extended_Pictographic` property): **344 → 230** across all 12 files; the
230 remaining are the deliberate exclusions above.

**`.card-title` icon/text split (found and fixed, not originally in scope):**
`.card-title{display:flex;justify-content:space-between}` was built for "title left,
badge/button right," but a title's own icon and its own text — as two bare flex
siblings instead of one element — got pushed to opposite edges instead of staying
together. This is the bug Tanish reported on the Day Book "Set up your Day Book" card;
a `jewelos-bug-pattern-reviewer` pass over the diff found ~30 more headers with the
same split, most pre-existing from batch55 (Shop Profile, Girvi Portfolio, Team
Members, every Settings card, several Reports/Orders cards). Verified with a
standalone Playwright DOM test (bare siblings → pushed apart; wrapped in one `<span>` →
stay together) before and after. Fixed everywhere the same way — wrap the icon + its
own title text in one `<span>`, leaving a genuine trailing badge/button as the second
flex item (already correct everywhere, e.g. "Developer Tools / Owner only"). No icon
meant no fix needed (a plain trailing badge with no icon, like "Supplier Ledger," was
already fine).

**Naming:** sidebar/bottom-nav/More-menu/page titles already said Stock/Sale
everywhere — the only two leftover "Inventory" mentions were inside the historical
`showV18Changelog()` "What's New" modal's copy, now "Stock".

**Day Book card alignment:** folded into the `.card-title` fix above.

## 🔍 How this was checked

`check.bat` clean on `23ee2a3`: syntax OK on all 11 files, regression suite **423/423**,
backup-check and roundtrip both **PASS**, AST/scope checks identical to the known
false-positive baseline. A `jewelos-bug-pattern-reviewer` pass over the diff found the
`.card-title` issue above (now fixed) and nothing else — no unsafe string splicing,
every `svgIcon()`/`data-icon` name resolves to a real `ICONS` key (cross-checked
independently with a script, not just by the reviewer).

**Not a real phone pass.** Verified by code reading, `check.bat`, and a standalone
Playwright DOM test isolating the exact CSS rule in question — not a phone pass against
this deployed build. Worth a look once live: every screen with a card header (Settings
tabs especially — a dozen+ cards changed structure there), the Sale screen's sticky bar
in all three states (nothing collected / partial / fully cleared), and the Day Book
empty-state card.

## sw.js — intentionally untouched

Same reasoning as batch55: `sw.js` (`jewelos-v20`) is network-first, so an
already-installed device picks up this batch's `index.html`/`js/*` on its next online
fetch. No cache-name bump needed.

## Not in this batch

Server-side: no `auth-gateway`/`store-proxy`/`razorpay-webhook` change, no migration,
no Supabase write of any kind. `jewelos.co` / `ALLOWED_ORIGINS` is unrelated and
untouched.
