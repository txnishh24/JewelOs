# Stored XSS remediation plan — finding 2 — 22 October 2026

Plan only, nothing implemented yet. Produced on Opus per `MODEL-POLICY.md` §8
(auth/security → Opus for analysis and planning). Scopes closing out
`SECURITY-REVIEW-2026-09-14.md` finding 2 ("Stored XSS — a staff account can hijack the
owner's session," HIGH once a shop has staff), last left "partly fixed... still open."
Supersedes the file:line list in `docs/SECURITY-AUDIT-SEMGREP-ZAP-2026-10-22.md` — that
list turned out to be incomplete; this plan adds 5 more sites it missed (marked `*`
below) found by actually reading each receipt/view function end to end rather than
trusting the line list.

## What's actually wrong, and what isn't

Every real value today (`GRV-0001`, `22K`, `gold`, a payment mode, a rate) contains no
`& < > "` and would render byte-identical after escaping — **this fix changes nothing
visible for normal data.** It only matters if a staff account writes something else
directly to the shop's JSON blob (not through the normal UI, which doesn't expose free
text in these fields) — then it currently runs as script instead of printing as text.

**Two things ruled out, not fixed, for a documented reason** (see "Site classification"
below): `js/09-purchases.js:192,210` (`r.bills`) is a false positive — a per-page counter
built from scratch, never read from saved data. Data-side validation (cleaning the
value once in `normaliseData` instead of escaping ~30 display sites) was considered and
rejected — `normaliseData` writes back to saved data, so a legitimate unusual value
(a custom purity string, an old `grvNo` format) would be silently altered and
re-synced. Escaping at the display site is the house rule and changes nothing stored.

**One gotcha that makes the obvious fix wrong in places:** `escHtml(s)` does
`String(s||'')` first, so `escHtml(0)` returns `''` — a 0 value disappears from the
screen (e.g. "Gross: g" instead of "Gross: 0g"). Any numeric field that can legitimately
be 0 needs `escHtml(String(x))`, not a bare `escHtml(x)`.

## Site classification (fix per site)

| Site | Context | Fix |
|---|---|---|
| `06-inventory-stock.js:1097,1250` (`r.icon`) | innerHTML | `escHtml(r.icon)` |
| `06-inventory-stock.js:1099` (`r.name`), `:1100` (`r.trigger`) | innerHTML | `escHtml(...)` — makes `:1099` match the already-escaped `:1251` |
| `06-inventory-stock.js:1110` (`r.id`) | double-quoted `id="..."` attribute | `escHtml(r.id)` — **not** `jsAttrEsc`; the browser decodes the attribute so `getElementById('wa-tpl-'+ruleId)` lookups at `:1040,1051,1074` still match the raw id; `jsAttrEsc` would leave backslashes in the decoded id and break them |
| `08-girvi-viewmode.js:1123` (`it.purity`,`it.metal`) | on-screen, then `document.write` receipt | `escHtml` |
| `08-girvi-viewmode.js:1123` (weight) | same | `escHtml(String(it.weight\|\|it.grossWt\|\|0))` |
| `08-girvi-viewmode.js:1111`\* (`g.grvNo`), `:1136`\* (`g.interestRate`) | same receipt | `escHtml`; rate needs `String()` |
| `04-orders-detail.js:435`\* (`o.ordNo`, inside `<title>`), `:462`\* | `document.write` order receipt | `escHtml` |
| `09-purchases.js:1464` (`b.totalItems`) | `document.write` | `(parseInt(b.totalItems,10)\|\|0)` — 0 is a real value here |
| `04-orders-detail.js:46-47` (`item.purity/metal/cat`), `:98` (`txn.type`) | innerHTML | `escHtml` |
| `02-ui-inactivity-modals.js:851,2060`, `01-sync-core.js:1270` (`purity`) | innerHTML | `escHtml` |
| `01-sync-core.js:1417,1631` (`mode`) | innerHTML | `escHtml` (an existing line 2 below `:1631` already does this — match it) |
| `07-settings-plans.js:626` (`it.purity/metal/grossWt`) | innerHTML, girvi form preview | `escHtml`; `String()` for `grossWt` |
| `06-inventory-stock.js:440,631`\* (`c.cat`) | innerHTML | `escHtml` |
| `08-girvi-viewmode.js:71,147,347`, `07-settings-plans.js:1004`, `03-billing-numbers.js:720,1321` (`g.grvNo`) | innerHTML | `escHtml` |
| `03-billing-numbers.js:1666` (`o.ordNo`) | innerHTML | `escHtml` |
| `08-girvi-viewmode.js:362`, `07-settings-plans.js:1028,1332`\* (`g.interestRate`) | innerHTML | `escHtml(String(...))` |
| `08-girvi-viewmode.js:956` (`g.interestRate`) | double-quoted `value="..."` attribute | optional, same as above |
| `09-purchases.js:192,210` (`r.bills`) | — | **no change** — false positive, local counter |

\* = found while planning, not in the original audit's list.

**Not a vulnerability, don't touch:** `qty>1 ? ...+x.qty` / `making>0 ? ...+'%'` guards
(text containing markup can never pass a `>1`/`>0` number comparison, so it never
prints); WhatsApp message text and exported filenames that embed `grvNo` as plain text,
not HTML (escaping those would wrongly print `&amp;`); `toast()`/`safeConfirm()` callers
(they set `textContent`, already safe); girvi photo `dataUrl`s (already fixed — guarded
to `data:image/` and escaped elsewhere).

## Batches, in ship order

**Batch 0 — prep, no `js/` changes.** Commit today's already-made `paymentStatus` fix
and the audit docs as their own commit first (keep unrelated work out of this diff).
Claim the HANDOFF NOW line. Run `check.bat` + `npm run test:e2e` once as a baseline to
diff every later batch against. Use the house byte-exact Python read-modify-write
script for every edit (several target lines contain `\uXXXX` escapes).

**Batch 1 — printed receipts (HIGH, ship first).** Sites: `08:1111,1123,1136`;
`04:435,462`; `09:1464`. Before fixing just the listed lines, read each receipt function
whole (`girviReceipt` ~`08:1040-1150`, `generateOrderReceipt` `04:416-482`, `pbPrintBill`
`09:1450` to its `document.write` close) and fix any other raw saved-data field the list
missed — same mistake the original audit made once already. Add a regression-test
assertion scanning these three files for `+(it|g|o)\.(purity|metal|grvNo|ordNo)+`,
`+g\.interestRate+`, `+b\.totalItems+` left raw. No e2e spec covers the order receipt —
manual print check needed (`skills/verify-ui.md`); girvi/purchase receipts are covered
by existing specs.

**Batch 2 — WhatsApp automation rules (MEDIUM).** Sites: `06:1097,1099,1100,1110,1250`.
No e2e coverage — manually open the Automation modal (Settings), Edit, Save, Preview,
confirm `editWaTemplate` still focuses the right field.

**Batch 3 — everyday dropdown fields (MEDIUM-LOW).** Sites: `04:46-47,98`;
`02:851,2060`; `01:1270,1417,1631`; `07:626`; `06:440,631`. Covered by
`sale.spec.js`/`edit-bill-reports-newsale.spec.js`; order-detail and the girvi
new-loan preview have no spec — check manually.

**Batch 4 — app-generated numbers/rates (LOW).** Sites: `08:71,147,347,362`;
`07:1004,1028,1332`; `03:720,1321,1666`; optionally `08:956`. Confirm `08:161`
(`grp.totalItems`) is a computed count before deciding whether it needs the fix too.

**Batch 5 — close-out.** Re-run the full `jewelos-security-auditor` methodology (the
list has already been shown incomplete once). Update finding 2's status in both
security docs with what was fixed vs. reviewed-and-safe-with-reason. HANDOFF LOG entry.
After deploy, `jewelos-deploy-verifier`.

**Every batch, same steps:** `node --check` on changed files → `check.bat` → relevant
e2e specs → `jewelos-bug-pattern-reviewer` → `jewelos-test-runner` → an independent
Opus review of that batch's diff (the standing additive rule, on top of the two
Sonnet-tier agents — this is 3 agents per batch, which exceeds CLAUDE.md's normal
"at most two agents per task" cap; treating this as the documented standing-rule
exception, same as today's single-site fix already did, and saying so in the LOG) →
commit only after all of that passes.

## Open questions for Tanish (blocking before execution, not before this plan)

1. **Nothing changes visually for real data** — the only visible differences are: a
   record with a missing purity/metal now shows blank instead of the literal word
   "undefined", and a tampered value shows as harmless text instead of running. OK to
   ship without a live demo first?
2. **Ship order** — may Batch 1 (receipts) go out alone as soon as it's verified, with
   Batches 2-4 following later, or does this need to be one single deploy?
3. **Urgency** — risk is HIGH only once a shop has staff logins. Does any live shop
   have staff today? (Cowork can check the live database — this decides whether this
   jumps ahead of other launch items or not.)
4. **Related stopgap** — a Content-Security-Policy header at the Cloudflare Worker
   (already recommended in the semgrep/ZAP audit) would limit the damage from anything
   this plan still misses. Needs Tanish's call on which outside origins to allow
   (Supabase, Razorpay, Sentry, Google Fonts). Add to this effort or track separately?

## Critical files

`js/08-girvi-viewmode.js`, `js/04-orders-detail.js`, `js/06-inventory-stock.js`,
`js/01-sync-core.js` (`escHtml` at `:1523`, `jsAttrEsc` at `:1529`),
`tests/regression.test.js` (existing assertion pattern to copy at `:3017-3023`).
