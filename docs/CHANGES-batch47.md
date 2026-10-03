# batch47 — Premium redesign token-hygiene pass + staff tab-order fix

Base: batch46, live since 2 Oct. Everything is in `index.html` and `js/`. Server side:
nothing new to deploy.

**This is a visual pass, plus one unrelated one-line logic fix.** No pricing, Girvi
interest math, billing totals, or stored data changed anywhere in the visual work. Every
commit was checked against the regression suite before moving to the next one.

**`js/00-config-state.js` and `js/01-sync-core.js` in this build are byte-identical to
batch46 (already live)** — this week's in-progress save-lock rework (generation counter,
canonical stringify, superseded-call handling) is deliberately NOT in this build. It is
preserved on branch `save-lock-wip` for a proper single-queue redesign, and ships as its
own batch once that's done. See `HANDOFF.md` for the full reasoning.

## 🎨 What changed (visual — Phases 1-5 of the premium redesign)

batch46 renamed the app's color tokens to the current midnight-ink/parchment/antique-gold
palette, but a number of hand-typed color literals and a few shared components never
picked up the rename. This pass is a style of "finish what batch46 started," screen by
screen:

- **Phase 1 — foundation tokens and shared components:** consolidated the type scale and
  radius scale, fixed two color-contrast failures, added the token set the redesign plan
  needed (`--on-gold`/`--on-ink`, `--wa`, `--silver-bg`, `--chart-1..6`, `--tap`, and the
  layout tokens `--topbar-h`/`--nav-h`/`--rail-w`), and re-bound the screen-agnostic shared
  CSS (buttons, form fields, cards, the generic table, badges, modal family A, toasts,
  empty states, skeletons) to it. Buttons are now one consistent system
  (primary/secondary/quiet/danger). Form fields are 48px/16px on phones (stops iOS
  auto-zoom) with an ink focus ring instead of gold. Modal family A is a bottom sheet
  under 640px.
- **Phase 2 — shell (login/signup, header, nav, dashboard):** removed the literal arrow
  suffix from 10 call-to-action button labels.
- **Phase 3 — Stock, Sales, Orders, Purchases, Reports, Settings:** ~40 stale pre-redesign
  gold/silver color literals repointed to the renamed tokens; generic form labels and
  table headers now get the same uppercase/letter-spaced treatment every other label in
  the design system already had; a new solid-fill `.btn-ink` style for the "+ Add
  product" / "+ New Order" / "+ Add Purchase Bill" header buttons.
- **Phase 4 — Girvi:** 78 stale color literals repointed across the edit modal, ledger,
  search chips, document upload, reminder tags, collection-efficiency bar, and new-loan
  wizard. Girvi's own labels/buttons already matched the design system, so no structural
  changes were needed here.
- **Phase 5 — Day Book:** 2 stale color literals repointed (the "Paid out / Received"
  divider and the "Day closed" card border). Day Book has no CSS section of its own — it
  inherits everything from the shared components Phases 1 and 3 already fixed.
- **Mobile bottom nav fix:** the nav bar had a stray extra 64px of bottom padding on top
  of the phone's safe-area inset, leaving the tap targets floating in the top half of an
  oversized bar with dead space below. Now the bar hugs its buttons plus the safe-area
  inset, matching its real height everywhere else it's referenced.

**Deliberately untouched across every phase:** the Girvi interest-ledger math, Day Book's
cash-derivation/Close-Day logic, the printed/previewed bill (its own separate styling
system), decorative multi-color chart bars (telling categories apart, not signaling
good/bad), the app's hand-drawn logo mark, and Customers (no mockup existed for it, out of
scope entirely).

## 🐛 Bug fixed

- **Staff accounts were losing Day Book and keeping Settings.** The staff-hide desktop-tab
  lookup used an 8-entry array missing `'daybook'`, while the real desktop tab bar has 9
  tabs — every index from `'reports'` on was off by one, so the `'settings'` entry in that
  array actually hid Day Book, and Settings itself was never hidden. One-line fix:
  `'daybook'` inserted between `'reports'` and `'settings'` in `js/05-auth-login.js`.
  Flagged (not fixed) during this redesign's own Phase 0 audit as unrelated logic; fixed
  now on Tanish's direct instruction. Not live-verified with an actual staff login — the
  e2e test shop has no staff account, and creating one just for this would leave real
  Supabase auth state with no way to clean it up from this session. A regression test
  pins the correct 9-tab order so this can't silently drift again.

## Before you deploy

Regression suite 319/319 on this exact tree (batch46's 318 + the new staff-tab-order
test), all 11 files syntax-clean, `backup-check`/`roundtrip` both clean, full e2e suite
run against this exact tree. `js/00-config-state.js` and `js/01-sync-core.js` are
byte-identical to batch46/live — verify their sha256 against production before deploying
if you want the extra confirmation.
