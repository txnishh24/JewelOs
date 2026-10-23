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

## Stored XSS — Batches 1-4 shipped, 22-23 Oct (commits fe2a426, 442577c, be174d2)

The remediation plan this section's "corrected status" scoped (`docs/STORED-XSS-REMEDIATION-PLAN-2026-10-22.md`) was fully implemented: Batch 1 (printed receipts), the `paymentStatus` gap, and Batches 2-4 (WhatsApp automation rule fields, everyday dropdown fields, app-generated numbers) — every site in the plan's table, plus 3 extra girvi `item.type` sites an independent Opus review caught that the plan's own list had missed. Each batch independently verified: `node --check`, full regression suite (429/429), AST checks, `jewelos-bug-pattern-reviewer`, `jewelos-test-runner`, and an independent Opus diff review. Not yet deployed as of this writing — see `docs/CHANGES-batch60.md`.

## Batch 5 close-out: full re-audit, 23 Oct — finding 2 is NOT closed

Per the plan's own Batch 5 instruction ("re-run the full `jewelos-security-auditor` methodology — the list has already been shown incomplete once"), a fresh full syntax-tree sweep of all 11 `js/` modules ran against the Batches-1-4 commit set. **It should not have been a formality: it found ~43 more raw sites, not on any previous list** (not the 14 Sep review's 611-site inventory, not the 22 Oct plan's table). Every one of the plan's own listed sites, and the 3 extra sites the earlier independent Opus review added, were spot-checked and confirmed actually fixed — the gap is sites nobody had looked at yet.

**Why the list kept being wrong:** the new sites are mostly where saved data passes through an object or map key first (`runInsightEngine`, `buildTodayActions`, `Object.entries` maps building dashboard insight/action objects) and only becomes HTML in a *different* function than the one that reads the field. A line-based "check these line numbers" list — which is what both the 14 Sep review's table and the 22 Oct plan's table were — structurally cannot see that indirection. Only reading a function's full data flow catches it, and apparently that still takes more than one pass.

**HIGH — reachable through completely normal typing, no staff-write-to-server or devtools needed:**
- `js/01-sync-core.js:1325` — the Edit Bill "Reason for edit" free-text box (typed at `:1334`, saved at `:1452`) goes raw into the Edit History list. Runs when the owner opens Edit Bill on that sale.
- `js/05-auth-login.js:1605`, `:1668` — a customer's name (typed into any sale, `js/02-ui-inactivity-modals.js:1493`, never sanitised) goes raw into a dashboard insight's text (rendered at `js/06-inventory-stock.js:306`), if that customer trips the "top debtor" (>40% of pending balance) or "top 3 customers by revenue" trigger. Runs on the dashboard, no attacker action needed beyond normal typing plus their balance/revenue crossing a threshold.

**MEDIUM — dropdown/enum fields from saved data, reachable with devtools (same threat model as the already-fixed Batches 2-4):**
`js/04-orders-detail.js:1591` (`girviRiskBadge()`, called from `07-settings-plans.js:1006` and `08-girvi-viewmode.js:349`); `js/06-inventory-stock.js:350,354,546,582` (purity/metal/cat on dashboard/Reports); `js/07-settings-plans.js:1253,1297,1307` (girvi payment mode, pledged-item purity/metal/weight — the plan fixed only the `:626` preview of these same fields, missing the detail view); `js/08-girvi-viewmode.js:804` (ledger mode); `js/08-girvi-viewmode.js:209` (archived girvi card's `item.type`, same field Batches 2-4 fixed elsewhere but missed here); `js/02-ui-inactivity-modals.js:663,668` (stock-movement type/status). Four sites put a raw value inside a double-quoted `class="..."` attribute (`07-settings-plans.js:1000`, `08-girvi-viewmode.js:343,597,914`) — a `"` in the value breaks out of the attribute, not just the innerHTML.

**LOW — app-generated numbers and numeric fields:** `07-settings-plans.js:880,1345`; `05-auth-login.js:1739,1760`; `08-girvi-viewmode.js:957`; `01-sync-core.js:1255,1256,1274-1276,1288,1300,1301,1323`; `02-ui-inactivity-modals.js:485,978`; `09-purchases.js:517`; running-total sites where a string `qty` would concatenate instead of add (`03-billing-numbers.js:1214,1226,1239`; `06-inventory-stock.js:446,547,583,633` — `normaliseData` doesn't coerce `qty` to a number).

**Other tracked findings, re-confirmed (same audit pass):** finding 4 (no `store_cas_write` history) — still open, unchanged. Finding 6 — **correction to this doc's earlier "unchanged" note**: `auth-gateway` now does real compare-and-swap (migration 008, `mutateBlob`/`auth_store_cas_write`), so finding 6 is fixed on the auth-store side; it's open only on `razorpay-webhook`'s unguarded read-modify-write of `shops`. Finding 8 (no signup rate limit, PBKDF2 at 100k iterations, no CSP) — still open, unchanged. Finding 10 (backup-restore version-prefix check) — still open, unchanged. No regressions found in findings 1, 3, 5. `npm audit` at root and in `checks/`: 0 vulnerabilities, both, same as before.

**Classification and next step:** per `MODEL-POLICY.md` §8, this is 🔴 (auth/security) and needs its own Opus-planned, scoped remediation batch before finding 2 can actually be called closed — the same discipline the 22 Oct plan already used for Batches 1-4, not an ad hoc fix bundled into a close-out pass. Not fixed this session; Tanish's call on priority and timing, same framing the 70th entry used for the original finding-2 scope.

## Batch 6: the Batch 5 list fixed, then a close-out of the close-out (23-24 Oct)

Per `docs/STORED-XSS-REMEDIATION-PLAN-BATCH6-2026-10-23.md`, all ~43 Batch 5 sites were fixed across three batches by severity: **6a** (`d1a26fd`) the 2 HIGH sites reachable by normal typing; **6b** (`2edca23`) the MEDIUM dropdown/enum sites; **6c** (`671ae03`) the LOW app-generated-number sites, plus a root-cause fix for the qty-concatenation bug (coerced at the 6 running-total sites that build the total, not at each display site). An independent Opus review on 6c confirmed all three batches together account for every one of the 41 real Batch-5 sites (+2 optional), nothing unaccounted for.

**Batch 6d (24 Oct): the close-out's own close-out found one more site.** A fresh full-source sweep — done from scratch, not as a cross-check against the Batch 5/6 lists, per that list's own repeated track record of being incomplete — found `js/10-daybook.js:756`/`:883`: a saved Day Book manual entry's date reaches `dbGoDate()` via a correctly-`jsAttrEsc()`'d onclick (Month view → By Person), but `dbGoDate()` itself only checked `k>dbToday()` before storing it — a crafted date string passes that comparison and then breaks `value="..."` on the date input's next render. Not on the 14 Sep review, the 22 Oct plan, the Batch 5 list, or the Batch 6 plan. Fixed same session, commit `354280f`: `dbGoDate` now requires `/^\d{4}-\d{2}-\d{2}$/`, the single choke point all 4 callers route through, plus `escHtml(dateKey)` at the render site as defence in depth. Independently Opus-reviewed (ran the fix through the test harness directly, not just read it; confirmed no other unguarded `_dbDate` writer exists; upgraded the regression test from a source-pattern check to one that actually calls `dbGoDate` with a crafted payload and asserts on the rendered HTML).

**Status, stated plainly:** as of 24 Oct, every site found across five full-sweep passes (14 Sep, 22 Oct, Batch 5, Batch 6a/b/c, Batch 6d) is fixed and verified. Given that every one of those five passes found something the previous ones missed, this is reported as *fixed as far as four successive full sweeps have found*, not as a provable zero. The next real test is the next full-app sweep — the standing pre-release `jewelos-security-auditor` check, not a special one-off for this finding.

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

*(Updated 23 Oct — see the two sections above for what changed since this doc was first written on 22 Oct.)*

- **What's actually fixed, as of 23 Oct:** `paymentStatus` (4 sites), Batch 1's printed
  receipts, and Batches 2-4's WhatsApp/dropdown/app-generated-number sites — all
  verified, all shipped in commits, **not yet deployed** (see `docs/CHANGES-batch60.md`).
- **What's still wrong, and bigger than tracked at any point before today:** stored XSS
  (finding 2) is **not closed.** A 23 Oct Batch 5 close-out re-audit found ~43 more raw
  sites no previous pass had seen, including 3 HIGH ones reachable through completely
  normal typing (Edit Bill's reason field, a customer's name feeding a dashboard
  insight) — no staff-write-to-server, no devtools needed. See the "Batch 5 close-out"
  section above for the full list. 🔴-risk, needs its own scoped, Opus-planned
  remediation pass — the same discipline Batches 1-4 already used — before this finding
  can honestly be called closed. Tanish's call on priority/timing.
- **The one thing the 22 Oct session corrected:** no credential rotation needed on
  `SB_KEY` — the earlier "critical JWT" alarm from the prior sessions was a false
  positive.
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
