# batch61 — JEWELOS-2 crash fix, 60th-entry text sweep, stored-XSS finding 2 (Batches 1-6d, now verified fixed as far as 5 full sweeps have found)

Base: the Cloudflare Worker's content as of batch59's deploy (`4397bb9`, 20 Oct). This
batch covers everything since that was blocked from deploying at batch60 (79th HANDOFF
entry), plus everything shipped after — 10 substantive commits, all `js/`/`index.html`/
test-only changes, no edge-function or migration changes:

- `d02b968` — Fix JEWELOS-2: stale split-payment row index crash in New Sale
- `3d555d1` — 60th-entry polish: sweep sub-11px text up to `--text-xs` (137+4 instances)
- `442577c` — Security audit (semgrep+ZAP): fix `paymentStatus` escaping gap
- `fe2a426` — Stored-XSS remediation Batch 1: escape printed receipts (girvi, order, purchase)
- `be174d2` — Stored-XSS remediation Batches 2-4: WhatsApp rules, dropdown fields, app-generated numbers
- `7aed909` — Batch 5 close-out: full re-audit (no code fix, found ~43 more sites)
- `d1a26fd` — Stored-XSS remediation Batch 6a: HIGH sites reachable by normal typing
- `2edca23` — Stored-XSS remediation Batch 6b: dropdown/enum fields
- `671ae03` — Stored-XSS remediation Batch 6c: app-generated numbers + qty root-cause fix
- `354280f` — Stored-XSS remediation Batch 6d: Day Book date input (close-out re-audit finding)

## Not in this batch

`97b2c03` (CORS localhost/127.0.0.1 carve-out in `auth-gateway`/`store-proxy`) touches
only Supabase Edge Functions, not static assets — already deployed to Supabase directly
and verified live end-to-end in the 63rd HANDOFF entry. Nothing for this Worker deploy
to do with it.

## ✨ What changed

**JEWELOS-2 (production crash, Sentry-captured 1 Oct):** `renderSplitRows()` in
`js/01-sync-core.js` used to close over a split-payment row's numeric index at render
time. If a row was removed between a keystroke and its handler firing, the stale index
could point past the shrunk array and throw — crashing the sale form before Save ever
ran, with no error banner. Handlers now close over the row object itself instead.
Tanish said "go" on this deploy specifically on 22 Oct (74th entry).

**60th-entry text sweep:** 137+4 CSS font-size declarations below the 11px legibility
floor, swept up to the existing `--text-xs` design token, across `index.html` and all
of `js/`.

**Stored-XSS remediation (finding 2 of `SECURITY-REVIEW-2026-09-14.md`) — now covers
every site found across 5 successive full-sweep audits** (14 Sep review, 22 Oct plan,
23 Oct Batch 5 close-out, 23 Oct Batch 6a/6b/6c, 24 Oct Batch 6d): printed receipts,
`paymentStatus`, WhatsApp automation rule fields, everyday dropdown/enum fields
(purity/metal/category/payment-mode/status/type), app-generated numbers
(grvNo/ordNo/interestRate/financerRate), the Edit Bill free-typed edit-reason box, a
customer's name surfacing in a dashboard insight, a qty-concatenation bug in 6 running
totals, and a Day Book manual entry's date breaking a `value="..."` attribute via
`dbGoDate()`. All now go through `escHtml()`/`jsAttrEsc()` (or a numeric coercion where
the field is numeric-only by construction) before reaching `innerHTML`/`document.write`/
an inline attribute. **Nothing changes visibly for real, non-malicious saved data** —
every real value today contains no `& < > "` and renders byte-identical after escaping.
**Status, stated plainly: fixed as far as 5 independent full-sweep passes have found —
not a provable zero**, since each of those 5 passes found something the one before it
missed. See `docs/SECURITY-AUDIT-SEMGREP-ZAP-2026-10-22.md` for the full history.

## 🔍 How this was checked

Each commit individually verified before merging into this deploy batch: `node --check`
clean on every touched file; full regression suite (433/433 as of the final commit,
`TZ=Asia/Kolkata`); `edge-functions.test.js` 74/0; all 10 `checks/*.js` AST scripts
clean, including the two that must always be (`backup-check`, `roundtrip`); local
Playwright e2e specs run and confirmed clean or pre-existing-flaky, not regressions.
Each commit also went through `jewelos-bug-pattern-reviewer` + `jewelos-test-runner`
and an independent Opus review per the standing project rule for security work.

Batch 6d's own Opus review ran the fix through the actual test harness (not just read
it), confirmed no other unguarded `_dbDate` writer exists, confirmed `escHtml` is the
correct helper for the `value="..."` context it fixed, and upgraded the regression test
from a source-pattern check to one that calls `dbGoDate()` with a crafted payload and
asserts on the rendered HTML.

## sw.js — intentionally untouched

Same reasoning as batch55-61: `sw.js`'s fetch handler is network-first (fetch, fall back
to cache on failure, refresh cache on success), so an already-installed device picks up
every file in this batch on its next online fetch. No cache-name bump needed.

## Not verified against a live screen this session

Same caveat as every prior batch: the authenticated screens where most of these fixes
actually render (Sale, Girvi, Purchases, Settings → Automation, Day Book) were not
clicked through in a real browser against production before this deploy — only local
regression/e2e suites and AST checks. Every change here is presentation/escaping-only
and trivially revertible (`git revert` the relevant commit + redeploy) if anything looks
off. `jewelos-deploy-verifier` runs immediately after this deploy to confirm the live
origin actually serves it, per standing project rule — that is not the same thing as a
real phone/browser click-through, which is still worth doing on the next session.
