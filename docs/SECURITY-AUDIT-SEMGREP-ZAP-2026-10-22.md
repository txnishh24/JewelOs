# JewelOS security audit — semgrep + OWASP ZAP — 22 October 2026

Claude Code (Sonnet), cost-free local tooling (no Strix/cloud spend). Static scan with
`semgrep` (v1.182.0, `p/security-audit` + `p/secrets` + `p/xss` rulesets, 214 rules, 26
git-tracked files in `js/` and `supabase/`). Dynamic scan with OWASP ZAP baseline (passive
only — crawl + header/response analysis, no active attack payloads) against the live
endpoint `https://jewelos.jewelos-e2e.workers.dev`.

This picks up and closes out three prior sessions (22 Oct, same day) that built the
pipeline but left the ZAP scan running in the background across a session boundary —
the earlier results never persisted. Both scans were re-run fresh and completed in this
session. Raw output: `.security-audit/semgrep-results.json` (gitignored), `~/zap-reports/
zap-report.{html,json}`.

This audit does **not** replace `SECURITY-REVIEW-2026-09-14.md` (the line-by-line auth/
XSS review `jewelos-security-auditor` re-checks against). An earlier draft of this
document claimed it found "nothing that review's methodology would have missed" — that
was wrong, and is corrected below. semgrep's generic rules pattern-match known-bad
constructs; they don't trace a hand-written `'<td>'+r.name+'</td>'` string concatenation
back to its source the way a dedicated syntax-tree sweep does. A same-day follow-up audit
(see "Stored XSS — corrected status" below) found the two methods have very different
coverage on this specific class of bug.

## Correction to earlier session notes

Prior session summaries (visible in claude-mem as S219–S222) flagged the hardcoded
`SB_KEY` in `js/00-config-state.js:4` as a **critical credential exposure requiring
rotation and a git history rebase**. That was wrong, and the fix should **not** be done:

- The JWT payload decodes to `{"role":"anon", ...}` — this is Supabase's public anon key,
  explicitly designed to ship in client-side code. It authenticates nothing by itself;
  every actual data path goes through `store-proxy`/`auth-gateway` (session-token auth),
  and per `CLAUDE.md`, direct PostgREST access was already removed. RLS backs it on the
  Supabase side regardless.
- The same session's own findings list this correctly as "false-positive JWT (public
  anon key)" in one place while escalating it to a blocker in another — an internal
  contradiction. The expiry is ~2036 (10 years from issue), not "63 years" as one note
  claimed.
- **No action needed.** Rotating this key would require updating every deployed client
  for no security benefit.

## Static findings — semgrep (13 raw hits → 1 real, now fixed)

| # | File:line | Rule | Verdict |
|---|---|---|---|
| 1 | `js/00-config-state.js:4` | `detected-jwt-token` | **False positive** — public anon key, see above |
| 2 | `js/03-billing-numbers.js:903` | `insecure-object-assign` | **False positive** — `Object.assign(p, _snap)` restores a local in-memory snapshot on a failed save (rollback), not external input |
| 3 | `js/04-orders-detail.js:749` | `insecure-object-assign` | **False positive** — `r` is this device's own `localStorage` cache (`loadCache()`), not attacker-controlled; already shop-id-checked before use |
| 4–13 | `js/09-purchases.js:1479,1502`, `js/10-daybook.js:1313–1321` | `unknown-value-with-script-tag` | **False positive** (9 of 10) — every interpolated field in these `document.write()` blocks is already `escHtml()`'d or numeric (`fmt()`); the rule can't see past the raw-looking template and flags the whole statement |
| — | `js/09-purchases.js:1389,1408,1474,1496` | (caught by manual review, not a direct semgrep hit — semgrep flagged the containing `document.write` statements but not this specific unescaped field) | **Real, low-risk gap — fixed this session, all 4 sites.** `b.paymentStatus` was concatenated raw instead of through `escHtml()` at two print/`document.write` views (1474, 1496) **and** two on-screen `innerHTML` renders (1389, 1408) — the independent Opus review and `jewelos-bug-pattern-reviewer` both caught the on-screen pair after the first pass only fixed the print views. Exploitability was already low — `paymentStatus` is a derived enum (`'Paid'`/`'Partial'`/`'Overpaid'`/`'Unpaid'`, set in code at `js/09-purchases.js:89`, never free-typed) — but fixed for defense-in-depth and consistency with the rest of the file. |

**Fix applied:** all 4 sites in `js/09-purchases.js` now read `escHtml(b.paymentStatus)`
instead of `b.paymentStatus`. Verified with `node --check`; comparisons against literal
strings (`:1342`, `:1376`, `:1402`) read the raw field, not the escaped render output, so
they're unaffected. Sent through `jewelos-bug-pattern-reviewer`, `jewelos-test-runner`,
and an independent Opus review per standing project rule — both review agents
independently confirmed correctness and flagged the same second pair of sites.

**Net result for what semgrep itself can see: zero outstanding findings.** This is
narrower than "zero outstanding static findings" (the earlier wording, now corrected) —
see the next section for what a deeper, targeted sweep found that semgrep's generic
rules don't.

## Stored XSS — corrected status (from a same-day Opus audit, not from semgrep)

Right after this document was first written, the dedicated `jewelos-security-auditor`
methodology (full syntax-tree sweep, run on Opus — the agent type wasn't registered as
invokable, so run via a general-purpose agent given its exact spec) was run separately
against the same codebase. It found **finding 2 from `SECURITY-REVIEW-2026-09-14.md`
("stored XSS", HIGH once a shop has staff) is still open far more broadly than tracked.**
That review already listed this as "Still open" for "dropdown values, record ids in
`onclick`, photo `dataUrl`s" — the Opus sweep supplies the actual list, which is longer
than that one-line description suggested:

- `js/06-inventory-stock.js:1097,1099,1100,1110,1250` — `r.icon`/`r.name`/`r.trigger` raw
  into `innerHTML`; `r.id` raw into a double-quoted `id="..."` attribute (a `"` in the id
  breaks out of the attribute). `r.name` is escaped at `:1251` but not at `:1099` — the
  two render sites disagree.
- `js/08-girvi-viewmode.js:1123` — `it.purity`, `it.metal`, weight and qty raw into the
  girvi receipt, which is then written to a new window with `document.write` (`:1156`) —
  runs with the app's own permissions, same risk class the original review flagged for
  reaching the session token.
- `js/04-orders-detail.js:46-48,98` — order item `purity`/`metal`/`cat`/`qty` and payment
  `txn.type` raw.
- `js/02-ui-inactivity-modals.js:851,2060`; `js/01-sync-core.js:1270,1417,1631`;
  `js/07-settings-plans.js:626` — `purity` and payment `mode` raw on stock/sale/payment-
  history screens.
- `js/03-billing-numbers.js:720,1321,1666`; `js/07-settings-plans.js:1004,1028`;
  `js/08-girvi-viewmode.js:71,147,347,362`; `js/09-purchases.js:192,210,1464` — `grvNo`,
  `ordNo`, `interestRate`, `bills`, `totalItems` raw. Normally app-generated or numeric,
  but reachable because a staff account can `PUT` an arbitrary shop blob.

All of these are reachable only by writing to the server directly (not through the
normal UI), same as the original review's framing — this is not a new regression, it's
the same open item, now mapped with file:line precision instead of a category
description. **This is a 🔴-risk item per `MODEL-POLICY.md` §8 (auth/security) and is not
fixed by this session.** It needs its own scoped remediation pass (Opus for planning,
per policy) rather than a drive-by fix bundled into this audit — the surface is 8 files
and several dozen call sites, not a one-line change like the `paymentStatus` fix below.

## Dynamic findings — OWASP ZAP baseline (12 warnings, 0 fails, all header hardening)

17 URLs crawled, 55 passive rules passed clean, 0 `FAIL-NEW`. All 12 `WARN-NEW` items are
missing-response-header hardening — standard for a Cloudflare Worker-hosted SPA, none
are exploitable on their own, none require code changes (all set at the Worker/CDN edge,
not in `js/`):

| Header / issue | Risk | Note |
|---|---|---|
| Content-Security-Policy not set | Medium | Would reduce blast radius of any future XSS; biggest single improvement available |
| Missing Anti-clickjacking header (`X-Frame-Options` / `frame-ancestors`) | Medium | App can be iframed by another origin |
| Sub Resource Integrity missing (2 instances) | Medium | No SRI on the scripts served from this origin — low relevance since they're first-party, not third-party CDN |
| Strict-Transport-Security not set (5 instances) | Low | No HSTS — downgrade-to-HTTP window on first visit |
| X-Content-Type-Options missing (5 instances) | Low | MIME-sniffing hardening |
| Permissions-Policy not set (5) / Cross-Origin-*-Policy headers missing (COEP/COOP/CORP, 1+1+5) | Low | Modern isolation headers, defense-in-depth only |
| Cross-Domain JS Source File Inclusion (1) | Low | Flagged because a script tag loads from a different origin (e.g. a CDN library) — expected for this app |
| "Suspicious Comments" (39 instances, informational) | None | Checked the actual evidence strings — ordinary code comments ("bug", "fix", "fallback" etc.), no secrets or internal URLs. No action. |
| Cacheable/storable content notes (informational) | None | Static asset caching behaving as expected for a PWA |

**None of these are exploitable by themselves.** They're the kind of finding every
unhardened static site gets. Worth doing before launch because they're all one-time,
free, config-only changes at the Cloudflare Worker — not because any of them is an
active vulnerability:

1. Add `Content-Security-Policy` (biggest value; start permissive — e.g. allow `'self'`
   plus the Supabase/Razorpay origins actually used — and tighten later).
2. Add `X-Frame-Options: DENY` or `frame-ancestors 'none'` in the CSP.
3. Add `Strict-Transport-Security: max-age=31536000; includeSubDomains`.
4. Add `X-Content-Type-Options: nosniff`.
5. Permissions-Policy / COOP/COEP/CORP — nice-to-have, not launch-blocking.

This is Worker config, not `js/*.js` — out of scope for this session to implement
without Tanish's say on the CSP allow-list (get it wrong and the app breaks, e.g. blocks
Razorpay's checkout script). Flagging as a recommendation, not doing it here.

## Other results from the same-day Opus audit (not from semgrep/ZAP)

- `npm audit` at repo root and in `checks/`: **0 vulnerabilities**, both.
- Findings 1, 3, 5, 9, 11 from the Sept 14 review: confirmed still fixed, no regression.
- Findings 4, 6, 7, 8, 10: confirmed still open, unchanged from the review (not new, not
  worse) — `store_cas_write` has no write history, `razorpay-webhook` has no
  compare-and-swap (still deployed as-is per Tanish's 13 Oct decision), signup has no
  rate limit/email verification, PBKDF2 is at 100,000 iterations, no CSP (matches this
  doc's own ZAP finding above), backup restore only checks a version-string prefix.
- Tenant isolation (every `store-proxy` call derives its shop from the session token,
  never a client-supplied id): holds, no new endpoint breaks it.
- New minor items found, not in the original review: the Sentry CDN loader in
  `index.html` runs with full app privileges and no integrity pin (low risk, can't be
  pinned anyway since it's a loader); `.claude/hooks/block-secret-writes.js` is wired to
  `Write|Edit|Bash` only, not PowerShell/MultiEdit/NotebookEdit (low risk, the hook
  itself is fine).
- Not checked (needs live access/approval): whether deployed `auth-gateway`/`store-proxy`
  match the repo source, whether migrations 007–009 are actually applied live, whether
  `SESSION_SECRET`/`RESEND_API_KEY`/`RAZORPAY_WEBHOOK_SECRET` are set and strong.

## Bottom line

- **The one thing this session fixed:** the `paymentStatus` escaping gap (4 sites,
  `js/09-purchases.js`), low risk, verified three ways.
- **The one thing this session corrected:** no credential rotation needed on `SB_KEY` —
  the earlier "critical JWT" alarm from the prior sessions was a false positive.
- **The one thing this session surfaced but did NOT fix:** stored XSS (finding 2) is
  open across ~8 files and several dozen sites — see above. 🔴-risk, needs its own
  scoped remediation pass, Tanish's call on priority/timing.
- **Before launch, worth doing:** the 5 security headers above, at the Cloudflare Worker
  level — config change, not app code, needs Tanish's input on the CSP allow-list (which,
  notably, would also reduce the blast radius of the still-open stored XSS above).
- Re-run this same pipeline (`semgrep --config=auto --config=p/security-audit
  --config=p/secrets --config=p/xss js/ supabase/` + the ZAP baseline docker command
  below) after any significant `js/` change, same cadence as `jewelos-security-auditor`
  — but remember semgrep alone will not catch hand-written stored-XSS; that needs the
  full `jewelos-security-auditor` syntax-tree sweep, not this pipeline.

```
docker run --rm -v "//c/Users/ADMIN/zap-reports:/zap/wrk/:rw" -t zaproxy/zap-stable \
  zap-baseline.py -t https://jewelos.jewelos-e2e.workers.dev \
  -r zap-report.html -J zap-report.json -I
```
