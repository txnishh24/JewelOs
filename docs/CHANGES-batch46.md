# batch46 — Luxury redesign: visual refresh across the whole app

Base: batch45, live since 1 Oct. Everything is in `index.html` and `js/`. Server side:
nothing new to deploy.

**This is a visual pass only.** No pricing, Girvi interest math, billing totals, or
stored data changed anywhere in this batch. Every commit in it was checked against the
318-test regression suite — still 318/318 — before moving to the next one. If something
looks different after this deploy and it's wrong, it's a styling mistake, not a numbers
mistake.

## 🎨 What changed (visual)

- **One consistent gold/ivory system**, replacing a patchwork of three different ways
  the code had of naming the same colors. Nothing about the gold/ivory look itself
  changed — this is the plumbing behind it, cleaned up.
- **Status colors** — Girvi overdue/at-risk, pending payments, profit vs. loss, order
  stages, customer risk, and similar — switched from generic bright SaaS red/green/amber
  to the same muted tones as the rest of your brand. This touches every screen and every
  popup/detail-view reachable from them (Dashboard, Stock, Sales, Girvi, Day Book,
  Reports, Orders, Purchases, Settings, Customers, and the Girvi/customer detail modals).
- **Money and weight columns now line up.** Stock, Sales, Girvi, Day Book and Purchases
  tables right-align figures with even digit spacing instead of ragged left-aligned text.
- **Headings use your Cormorant Garamond font consistently** — it was being retyped by
  hand in 15+ places before, now it's one shared setting.
- **New trust line on the sign-in screen**: "Your shop data is private, encrypted, and
  always yours to export."

## 🐛 Small bugs fixed

- Row-action buttons (Edit/Delete) in tables were under Android's comfortable minimum
  tap size — bumped up so they're easier to hit on a phone.
- "Signing in..." showed in red, which read like an error even though login was working
  — now a neutral gold while it's just loading.
- Payment-warning and loan-to-value pop-ups ("this is more than expected, continue?")
  used the exact same red as a real delete-confirmation. They're now amber, so a genuine
  "are you sure you want to delete this" still stands out as the only red one.
- Bottom nav now has enough bottom padding that the Netlify badge can't sit on top of
  tappable buttons. The badge itself is still there — that's a hosting-level thing, not
  something fixable from the code, and you'd already decided to leave it rather than
  fight it.

## 🗣️ New bilingual copy

- Orders, Purchases, and Reports' empty states ("no bills yet", "no pending balances",
  etc.) now use the same warm Hinglish tone your WhatsApp reminder messages already use,
  instead of plain English.

## ⚠️ Known, not touched in this batch

- **The printed/previewed bill itself** (what you hand a customer) wasn't touched — it's
  a separate, self-contained styling system from the rest of the app. Deliberately out
  of scope for this pass.
- **A few decorative chart colors** (Reports' metal-wise and category-wise breakdown
  bars) were deliberately left multi-colored on purpose — they're telling categories
  apart, not signaling good/bad, so they don't belong in the same red/amber/green system
  as everything else.
- **The app's own logo mark** (the faceted gem icon in the top-left) wasn't touched —
  that's hand-drawn artwork, not a color that needed fixing.

## Before you deploy

Screenshots for every screen, before and after, at phone/tablet/desktop widths, are in
`redesign-shots/` in this folder if you want to eyeball anything before uploading. Run
`check.bat` one more time yourself if you want the full regression suite to re-confirm
nothing's broken — it already has, every step of the way, but it costs nothing to check
again right before a deploy.
