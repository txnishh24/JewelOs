# batch60 — JEWELOS-2 crash fix, 60th-entry text sweep, stored-XSS Batches 1-4 + paymentStatus (does not close finding 2 — see below)

Base: the Cloudflare Worker's content as of batch59's deploy (`4397bb9`, 20 Oct). This
batch covers 5 commits since, all `js/`/`index.html` changes, no edge-function or
migration changes:

- `d02b968` — Fix JEWELOS-2: stale split-payment row index crash in New Sale
- `3d555d1` — 60th-entry polish: sweep sub-11px text up to `--text-xs` (137+4 instances)
- `442577c` — Security audit (semgrep+ZAP): fix `paymentStatus` escaping gap
- `fe2a426` — Stored-XSS remediation Batch 1: escape printed receipts (girvi, order, purchase)
- `be174d2` — Stored-XSS remediation Batches 2-4: WhatsApp rules, dropdown fields,
  app-generated numbers (plus 3 extra sites an independent Opus review caught that
  the remediation plan's own site list had missed)

## ✨ What changed

**JEWELOS-2 (production crash, Sentry-captured 1 Oct):** `renderSplitRows()` in
`js/01-sync-core.js` used to close over a split-payment row's numeric index at render
time. If a row was removed between a keystroke and its handler firing, the stale index
could point past the shrunk array and throw — crashing the sale form before Save ever
ran, with no error banner. Handlers now close over the row object itself instead.
Tanish said "go" on this deploy specifically on 22 Oct (HANDOFF's 74th entry).

**60th-entry text sweep:** 137+4 CSS font-size declarations below the 11px legibility
floor, swept up to the existing `--text-xs` design token, across `index.html` and all
of `js/`. Same category of fix as batch59's 60-instance sweep, found and fixed
separately in the 68th HANDOFF entry.

**Stored-XSS remediation (finding 2 of `SECURITY-REVIEW-2026-09-14.md`, narrows it, does
NOT close it):** `paymentStatus` plus every site listed in
`docs/STORED-XSS-REMEDIATION-PLAN-2026-10-22.md`'s site-classification table (printed
receipts, WhatsApp automation rule fields, everyday dropdown fields like
purity/metal/category/payment-mode, and app-generated numbers like
`grvNo`/`ordNo`/`interestRate`) now go through `escHtml()` (or `escHtml(String(x))`
where the field can legitimately be `0`) before reaching `innerHTML`/`document.write`.
**Nothing changes visibly for real, non-malicious saved data** — every real value today
contains no `& < > "` and renders byte-identical after escaping. **A same-day Batch 5
close-out re-audit found finding 2 is still open far more broadly than this batch's plan
knew about** — ~43 more raw sites, 3 of them HIGH and reachable through completely
normal typing (no staff-write-to-server, no devtools). None of that is fixed in this
batch; see `docs/SECURITY-AUDIT-SEMGREP-ZAP-2026-10-22.md`'s "Batch 5 close-out" section
for the full list and next steps.

## 🔍 How this was checked

Each commit individually verified before merging into this deploy batch: `node --check`
clean on every touched file; full regression suite 429/429 (`TZ=Asia/Kolkata`);
`edge-functions.test.js` 74/0; all 10 `checks/*.js` AST scripts clean, including the two
that must always be (`backup-check`, `roundtrip`); full local Playwright e2e suite run
twice for the Batches 2-4 diff (once with it applied, once stashed out against baseline)
— confirmed 7-8 pre-existing failing specs are shared-test-shop-state flakiness, not a
regression. Each commit also went through `jewelos-bug-pattern-reviewer` +
`jewelos-test-runner` and an independent Opus review per the standing project rule.

A full `jewelos-security-auditor` re-audit (Batch 5 close-out) ran separately against
this exact commit set before this deploy — see `docs/SECURITY-AUDIT-SEMGREP-ZAP-2026-10-22.md`
for its findings.

## sw.js — intentionally untouched

Same reasoning as batch55-59: `sw.js`'s fetch handler is network-first (fetch, fall back
to cache on failure, refresh cache on success), so an already-installed device picks up
every file in this batch on its next online fetch. No cache-name bump needed.

## Not in this batch

No Supabase Edge Function change — `auth-gateway`/`store-proxy` stay at whatever
versions are already live (last touched 21-22 Oct for the CORS localhost carve-out,
deployed separately). No migration, no RLS change. Batches 2-4 of the WhatsApp/
dropdown/app-number XSS sites and the JEWELOS-2 fix are logic/display-only — no change
to Girvi interest math, GST calculation, or sync/retry behaviour.

**Not verified against a live screen this session** (same caveat as batch59): the
authenticated screens where most of these fixes actually render (Sale, Girvi, Purchases,
Settings > Automation) were not clicked through in a real browser against production —
only the local regression/e2e suites and AST checks. Worth a real phone pass on the next
session; every change here is presentation/escaping-only and trivially revertible
(`git revert` the relevant commit + redeploy) if anything looks off.
