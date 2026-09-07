---
name: jewelos-debug
description: Use when something in JewelOS is broken, blank, frozen, not saving, or showing the wrong data — including vague reports like "the orders tab doesn't work" or a screenshot of a broken screen. Covers the reproduce-isolate-patch loop and the bug families this codebase produces repeatedly.
---

# Debugging JewelOS

## Get a real symptom first

Tanish tests on a real device; you cannot. Before touching code, get:

- what he clicked, and what happened instead of what he expected
- the exact console error, or a screenshot
- whether it happens on a fresh login, a second account on the same device, or
  only for one shop

If he cannot reproduce it on demand, say so and ask rather than guessing at a fix.
Guessing has cost real time on this project — one "duplicate buttons" report turned
out not to exist in the code at all.

## Run the checks before reading code

```
cd ~/Downloads/jewelos-checks && node scope.js /path/to/build && node handlers.js /path/to/build
```

A whole section going blank or dead is almost always a missing reference, and these
catch that in seconds. `scope.js` finds names used but never declared; `handlers.js`
finds buttons whose `onclick` points at nothing.

## The five bug families this codebase actually produces

Check these before inventing a new theory. Every one has bitten more than once.

1. **Unscoped `localStorage` key.** Symptom: a second account on the same device
   sees the first account's data, or skips a screen it should see. Six occurrences
   so far. Fix: route the key through `shopScopedKey()`.
2. **Locally-nested function called from an outer scope.** Symptom: a feature works
   in one place and silently does nothing everywhere else. `ordAdvance` was defined
   inside `generateOrderReceipt()` while eight other call sites expected a global.
   Fix: hoist to a true top-level function.
3. **Reference to an id or function that never existed.** Symptom: a button does
   nothing at all, no error. `#add-prod-btn`, `#of-goldpurity`, `window.viewBill` —
   all shipped broken for months. Fix: `ids.js` and `handlers.js` find these.
4. **Fragile position-based matching.** Symptom: the wrong tab highlights, the wrong
   row updates. Settings tabs broke because a JS array's order drifted from the HTML.
   Fix: match on an explicit `data-` attribute, never on array position.
5. **A diagnostic or fallback testing a path that no longer exists.** Symptom: an
   error message that contradicts working behaviour. `cloudDiag()` reported "shop key
   rejected" on healthy installs because it still sent the pre-v5 auth header.
   Fix: make the diagnostic send exactly what the real code path sends.

## Isolating

Reproduce → narrow to one module → patch that module. Do not rewrite whole files
unless asked. When a symptom spans modules, follow the data: `S` is the single state
object, `saveToCloud()` is the single write path, `store-proxy` is the single
server path.

For sync and save problems specifically, `cloudDiag()` (Settings → About, or the
console) reports shop key, sync status, and store-proxy/auth-gateway reachability.

## Verifying the fix

State the failure mode you are fixing in terms of concrete inputs and observed
behaviour, then confirm the patch changes exactly that. Re-run the full checks
suite and compare against the pre-fix baseline — same hits, not fewer, means you
introduced nothing new.

Then be honest about the remaining gap: logic is verifiable here, DOM behaviour is
not. Say which of the two your fix falls into.

## Logging it

If the bug was a member of one of the five families above, that is worth a line in
`decisions/log.md` — the pattern repeating is the finding, not the individual fix.
