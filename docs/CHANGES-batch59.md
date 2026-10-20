# batch59 — undersized UI text + low-contrast demo banner

Base: the Cloudflare Worker's content as of batch58's 20 Oct deploy (`fd00b5f`). This
batch covers the single commit since: `4397bb9` (HANDOFF/doc-only commits in between
touch no served file).

## ✨ What changed

**`index.html` only, CSS values only — 55th entry.**

Found via an offline run of the third-party "Impeccable" design-review tool's
deterministic `detect` scanner, pointed at an isolated scratch clone (not this repo —
no hooks/settings were ever installed here). 181 raw findings; the "slop"-category ones
(font choice, card borders, gradient hue, glow shadow — style opinion, not defects) were
left alone. Two findings were real and fixed:

- **60 CSS declarations** hardcoded `font-size:10px` or `9.5px` instead of the existing
  `--text-xs` design token (12px) already defined in `:root` — form labels, table
  headers, bottom-nav items, and timestamps across Sale/Inventory/Girvi/Day
  Book/Purchases were below an 11px legibility floor. Swapped all 60 to
  `var(--text-xs)`. Left `.doc-slot-del` (an 18px circular delete-icon glyph, not
  reading text) and two pre-existing 11.5px body-text spots alone (already above the
  hard floor).
- **Demo-mode banner contrast**: `#demo-banner`'s gradient lighter stop (`#a855f7`) was
  4.0:1 against white text, below WCAG AA's 4.5:1. Darkened to `#9333ea` (5.38:1).

## 🔍 How this was checked

`check.bat`: 11/11 files OK, regression suite passed, backup-check and roundtrip both
PASS. Zero `.js` files touched.

Visually spot-checked in a real browser (local static server serving this exact repo
folder, same as Netlify Drop): Sign In screen's footer (Privacy Policy / Terms of
Service / © JewelOS, was 10px) and the Create Account form's 5 field labels (YOUR NAME /
EMAIL / PASSWORD / SHOP NAME / CITY, was 10px) — both render cleanly at 12px, no overflow
or layout breakage.

**Not verified against a live screen:** every authenticated screen (Sale, Inventory,
Girvi, Day Book, Settings) — where most of the 60 fixes actually render — because
reaching them needs a real login, and this session would not submit the real
autofilled credentials sitting in the Sign In form against production Supabase. Worth a
real phone pass on the next session; this is presentation-only and trivially
revertible (`git revert 4397bb9` + redeploy) if anything looks off.

## sw.js — intentionally untouched

Same reasoning as batch55-58: `sw.js` is network-first, so an already-installed device
picks up this batch's one changed file on its next online fetch. No cache-name bump
needed.

## Not in this batch

No Supabase Edge Function change — `auth-gateway`/`store-proxy` stay at the versions
batch58 deployed (v9 / v10). No migration, no RLS change, no logic/calculation change.
