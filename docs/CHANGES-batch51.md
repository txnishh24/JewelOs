# batch51 — Motion pass: the app finally animates instead of snapping

Base: batch50 (confirmed live — the manifest name fix is already on the live site).
Everything below is new on top of what's currently deployed.

**This is a visual pass only.** No pricing, GST, stock quantity/weight, Girvi interest,
login/PIN logic, or Supabase calls changed anywhere in this batch. Every commit was
checked against the regression suite (386/386) and the full Playwright e2e suite (22/23 —
the one failure is a pre-existing, unrelated flake in `session-restore.spec.js`, confirmed
to reproduce identically on the pre-batch51 baseline) before moving to the next one.
A `jewelos-bug-pattern-reviewer` pass and a full console/network error check (zero errors
found, mobile + desktop) ran before this was packaged.

## 🎨 What changed

- **Modals and the Day Book sheets now fade and scale in/out**, instead of snapping
  instantly into and out of existence. On a phone (under 640px) they slide up from the
  bottom like a real bottom sheet — they were already *shaped* like one, they just never
  moved like one.
- **The sync dot pulses while a save is in progress.** The animation was written into the
  stylesheet a while back but never actually attached to anything — wired it up.
- **The thin progress bar under the top header now actually moves** while syncing (it had
  a working width transition but nothing was ever setting a width to animate to).
- **Typing a customer name shows the suggestion list with a quick fade**, on the Sale form,
  the Order form, and Day Book's "link to a person" field. Retyping doesn't re-animate —
  only the list opening/closing does, so it never feels laggy while you type.
- **Turning on "reduce motion" (iOS/Android/Windows accessibility setting) now only removes
  movement**, not every bit of visual feedback — buttons, tabs, and focus states still give
  their normal (already brief) response; only the new sliding/scaling above goes still.
- A few empty-state screens ("No sales this month yet", "No active girvi loans", etc.) get
  a small fade-in the first time they appear.
- Cleanup: ~22 places in the stylesheet that animated "everything that changes" now only
  animate the specific color/background/border they're actually meant to — fixes nothing
  visible, just stops the browser doing unnecessary work on every hover and tap.

## 🔍 How this was checked

- `node --check` on all 11 `js/` files, the 386-test regression suite, and all 9
  `checks/*.js` AST scripts — clean (the usual pre-existing, documented false positives
  only; `backup-check` and `roundtrip` both clean).
- Full Playwright e2e suite run three times across this work (22/23 each time, same
  pre-existing unrelated flake).
- A real headless-browser pass: every one of the app's 9 tabs visited on both a phone-size
  (393px) and desktop-size (1280px) viewport — zero console errors, zero failed network
  requests. Confirmed a modal's close button is clickable within ~10ms of opening (the
  fade-in never blocks a tap), and that a real save to the cloud is untouched by any of
  this (pure network time, no animation code in that path).
- One real bug was caught and fixed *during* this work, not shipped: an early version of
  the modal CSS was silently invalid (a duration token that already carries its own easing
  curve had a second one appended after it), which would have made the fade-in snap
  instantly instead of animating. Caught by sampling opacity mid-transition instead of
  only checking before/after — fixed before this batch was packaged.

## 🟢 Low — everything above is this severity

Cosmetic/UI only. Nothing here changes a number on a bill, a stock count, a Girvi balance,
or who can log in.
