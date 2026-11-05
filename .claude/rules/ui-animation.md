---
paths:
  - "index.html"
  - "css/**"
  - "js/**"
---

# UI and animation work

JewelOS is vanilla ES5 + one `index.html` — no React, no build step, no Tailwind. Skills that
assume a framework give advice, not code to paste. Convert it to plain HTML/CSS/ES5.

Use, without asking Tanish which:

- **Designing or restyling a screen** → `ui-ux-pro-max` (spacing, hierarchy, empty/error states,
  accessibility), then `taste-skill` if it still looks generic.
- **Reviewing a finished UI change** → `/design-review` (gstack), on a local build only.
- **Adding or reviewing motion** → `animation-vocabulary` to name what you want,
  `find-animation-opportunities` to spot where it helps, `improve-animations` /
  `review-animations` to polish, `emil-design-eng` for small finishing details.
- **Clicking it through** → `skills/verify-ui.md` (Playwright). Never against a customer shop;
  use the E2E test shop `77c4aefe`.

Constraints that win over any design skill:

- Shop owners use cheap Android phones in bright shops: keep animations short (under 250 ms),
  CSS-only (`transform` / `opacity`), and honour `prefers-reduced-motion`.
- Never animate money, weight or stock figures in a way that hides the number while it changes.
- Text from data goes through `escHtml()`; inline `onclick` values through `jsAttrEsc()`.
- Fonts or libraries from a CDN need Tanish's sign-off: the app must keep working offline.
