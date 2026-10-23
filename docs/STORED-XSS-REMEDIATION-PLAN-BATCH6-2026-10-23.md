# Stored XSS remediation plan — Batch 6 (finding 2, round 3) — 23 October 2026

This is a plan only. Nothing is implemented yet. It was produced on Opus per `MODEL-POLICY.md` §8
(auth/security → Opus for analysis and planning), with the same discipline as
`docs/STORED-XSS-REMEDIATION-PLAN-2026-10-22.md` (Batches 1-5). It scopes the ~43 sites that
the Batch 5 close-out re-audit found (`docs/SECURITY-AUDIT-SEMGREP-ZAP-2026-10-22.md`,
"Batch 5 close-out"). All line numbers were checked against HEAD `680ee06`.

**How this list was built.** The close-out list was not copied. Every site was re-read in its
own function, and then traced back to the function that produced the value. Summary:

- **41 of the 43 are real and need a change.** 2 are not exploitable today (marked †). They get
  an optional one-token fix for defence in depth.
- **1 line number was wrong.** `07:1297` is really `07:1298` (`:1297` is already escaped and
  guarded).
- **The 7 qty running-total display sites get fixed at the 6 lines that build the totals**, not
  where the totals are displayed (see Batch 6c). That fixes the root cause, which is string
  concatenation, and the XSS goes away with it.
- **The same functions, plus a sweep for the same indirection pattern, found no new
  exploitable site.** The sweep covered `Object.entries`/`Object.keys` maps that reach HTML,
  object literals with `text/sub/title/label`, raw fields inside `value=/class=` attributes, and
  customer-name concatenations. It did find 5 suspects that are safe, with the reason for each
  (table at the end), and 3 crash bugs that are not XSS (listed, not fixed here).

The gotcha from the original plan still applies. `escHtml(s)` runs `String(s||'')` first, so
`escHtml(0)` returns `''`. Any field that can legitimately be 0 needs `escHtml(String(x))` or a
number coercion, never a bare `escHtml(x)`.

## What's actually wrong

The HIGH sites are different in kind from Batches 2-4. **No devtools and no direct write to the
blob are needed.** A staff member types `<img src=x onerror=...>` into a normal text box:

- the customer name on any sale, or
- the "Reason for edit" box in Edit Bill.

The script runs in the owner's session. For the dashboard case it runs on the **first screen
the owner sees** after login. It needs only that customer's balance or revenue to cross an
insight threshold, which a staff member can arrange with one large credit sale. This is the same
staff → owner session-hijack described in `SECURITY-REVIEW-2026-09-14.md` finding 2.

**Why previous sweeps missed these:** the value is read in one function and becomes HTML in
another (`runInsightEngine` → `renderDash`). Both of those functions look clean when read alone.

**Fix at the producer, not the renderer (6a).** `ins.text` and `a.sub` deliberately carry markup
(`<strong>`) and an already-escaped `escHtml(g.customer)`. Wrapping `06:286`/`06:306` in
`escHtml` would print a literal `<strong>` and double-escape names. The escaping belongs where
the saved field joins the string, in `05-auth-login.js`.

## Site classification (fix per site)

**6a — HIGH, normal typing reaches it**

| Site | Value / context | Fix |
|---|---|---|
| `01-sync-core.js:1325` | `h.reason` (Edit Bill reason, typed `:1334`, saved `:1452`) → innerHTML | `escHtml(h.reason\|\|'Edited')` |
| `01:1323` | `h.version`, same 5-line block | `escHtml(String(h.version))`. It is app-generated, but it sits in the same row and gets the same review. |
| `05-auth-login.js:1605` | top-debtor name, `topDebtor[0].split('_')[0]` → `ins.text` → `06:306` | `escHtml(topDebtor[0].split('_')[0])` |
| `05:1668` | top-3 customer names, same path | `escHtml(e[0].split('_')[0])` inside the `.map` |
| `05:1739`, `05:1760` | `g.grvNo` / `o.ordNo` → `a.sub` → `06:286` | `escHtml(...)`. These are LOW on their own, but they are on the same screen and covered by the same check. Fixing them here means the dashboard is fully done in one pass. `:1760` contains a `\u` escape (en dash), so use the byte-exact edit. |

Checked and safe in the same functions: every other `text`/`title`/`sub`/`badgeText` in
`runInsightEngine`/`buildTodayActions` is built only from counts, `fmt()`, `toFixed()` or
`Math.round()`. `ins.type`/`a.type`/`a.icon` are app constants. Elsewhere in `openEditBill`,
`fmt(h.grand)` and `fmtDate/fmtTime(h.at)` are safe.

**6b — MEDIUM, dropdown/enum fields (needs a direct blob write or devtools, same as Batches 2-4)**

| Site | Value / context | Fix |
|---|---|---|
| `04-orders-detail.js:1591` `girviRiskBadge(r)` | `r` = `g.risk`, called from `07:1006` and `08:349` | Fix once, inside the helper: `escHtml(String(r).charAt(0).toUpperCase()+String(r).slice(1))`. The `String()` also stops a crash: today a non-string `r` throws on `.charAt`. |
| `06-inventory-stock.js:350`, `:354` | purity map key `e[0]` (dashboard gold/silver breakdown) | `escHtml(e[0])` |
| `06:546` | metal key `m` (Reports metal-wise) | `escHtml(m)` in the label only. The `metalColors[m]`/`metalEmoji[m]` lookups stay as they are. |
| `06:582` | category key `cat` (Reports category bars) | `escHtml(cat)`, matching the already-escaped `06:631` |
| `07-settings-plans.js:1253` | `p.mode\|\|(isAdj?p.type:'Cash')` (girvi detail payment rows) | wrap the whole expression in `escHtml(...)`. The line has `\u` escapes (rupee sign), so use the byte-exact edit. |
| `07:1298` (listed as `1297`) | `it.purity`, `it.metal`, `(it.weight\|\|it.grossWt)` (single pledged item) | `escHtml` each. Weight only prints when truthy, so no `String()` is needed. |
| `07:1307` | same three fields (multi-item list) | same |
| `08-girvi-viewmode.js:804` | `e.mode` (ledger meta) | `escHtml(e.mode)`. The line has a `\u` escape (bullet), so use the byte-exact edit. |
| `08:209` | archived card `items[0].type`/`item.type` | wrap the whole `(...)\|\|'Item'` expression in `escHtml` |
| `02-ui-inactivity-modals.js:663` | `typeLabel[m.type]\|\|m.type` (stock movement history) | `escHtml(typeLabel[m.type]\|\|m.type)` |
| `02:668` | `m.prevStatus`, `m.newStatus` | `escHtml` each. The `'—'` fallbacks stay outside. |
| `08:597` | `l.type` inside `class="ge-audit-dot ..."` | `escHtml(l.type\|\|'edit')`. A `"` in it breaks out of the attribute. |
| `08:914` | `e.type` inside `class="gt-dot ..."` | `escHtml(e.type\|\|'edit')`. Payments are regex-constrained, but ledger entries are not. |
| `07:1000` †, `08:343` † | `status` inside `class="girvi-card status-..."` | **Not exploitable.** `g.status` is overwritten by `girviComputeStatus()` unless it is exactly `'closed'`/`'defaulted'`, immediately before (`07:906`, `08:228`). The `07` copy is also dead code, because it is overridden by `08`. Optional fix: `escHtml(status)`, in case a future change reorders that code. |

**6c — LOW, app-generated numbers and numeric fields**

| Site | Value / context | Fix |
|---|---|---|
| `07:880` | `g.grvNo` (girvi today-actions) | `escHtml(g.grvNo)` |
| `07:1345` | `g.financerRate` | `escHtml(String(g.financerRate))`. A rate of 0 is legitimate. |
| `08:957` | `g.duration` in `value="..."` | `(parseInt(g.duration,10)\|\|3)`, the same default as today |
| `01:1255`, `:1256` | `sale.discount`, `sale.gst` in `value="..."` | `(parseFloat(x)\|\|0)`, matching `:1253-1254` right above |
| `01:1274-1276` | `item.lockedRate/making/diamond` in `value="..."` | `(parseFloat(x)\|\|0)` |
| `01:1288` | `sp.amount` in `value="..."` | `(parseFloat(sp.amount)\|\|0)` |
| `01:1300`, `:1301` | `oldGold.value`, `prevAdvance.amount` in `value="..."` | `(parseFloat(...)\|\|0)` |
| `02:485`, `02:978` | `p.qty` (Adjust Stock modal, sale product search) | `escHtml(String(p.qty))`. **0 is a real stock count.** A bare `escHtml` would show blank. |
| `09-purchases.js:517` | `item.qty` in `value="..."` (editing a saved bill, `PB_ITEMS` loaded at `:599`) | `(parseInt(item.qty,10)\|\|1)`, the same rule as its own `oninput` |
| qty running totals, displayed at `03:1214,1226,1239` and `06:446,547,583,633` | `0 + "5"` → `"05"`, and a string with markup concatenates straight into HTML | **Fix where the totals are built**, at 6 lines: `03-billing-numbers.js:1209` (`u+=i.qty` → `u+=(parseFloat(i.qty)\|\|1)`), `03:1220` (`q=i.qty\|\|1` → `q=parseFloat(i.qty)\|\|1`), `03:1236` (`n=...` the same way), and `06:117`, `06:534`, `06:570` (`+=(i.qty\|\|1)` → `+=(parseFloat(i.qty)\|\|1)`). `06:117` feeds both `:446` and `:633`. |

Why the `value="..."` fixes use `parseFloat` and not `escHtml(String())`: these are
`type="number"` inputs. The browser already blanks a non-numeric `value`, and the save path
already runs `parseFloat` on every one of these fields (`01:1353-1378`). So this changes nothing
visible and nothing stored. It also matches the two lines directly above.

**One visible change in 6c:** `03:1209` has no `||1` today, so a sale item with no saved `qty`
shows `NaN` units in "Top products". After the fix it shows 1, which is the same rule every other
units count already uses.

## Batches, in ship order

**Prep, no `js/` changes.** The working tree is clean except for the untracked
`COWORK-BRAIN.md`. That file is not ours, so keep it out of every commit. The HANDOFF NOW line is
already claimed (`680ee06`). Run `check.bat` and `npm run test:e2e` once as a baseline. Measure
the regression count fresh; the "429/429" in the audit doc is a remembered number, so don't reuse
it. Use the house byte-exact Python read-modify-write script for every edit. Several target lines
contain `\uXXXX` escapes; they are flagged above.

**Batch 6a — HIGH, ship first and alone** (6 sites in 2 files). This uses the same reasoning as
Batch 1's receipts: it is the only group reachable without devtools, and a small diff is quick to
review and deploy. Add regression assertions, copying the pattern at `tests/regression.test.js`
`:3017-3053`:

- `openEditBill` has no `'+(h.reason||'Edited')+'`
- `runInsightEngine` has no `split('_')[0]+'` and no `.join(', ')+'</strong>` without `escHtml`
- `buildTodayActions` has no `'+g.grvNo+'` / `'+o.ordNo+'`

E2E: `edit-bill-reports-newsale.spec.js` (Edit Bill). The Edit History list only appears from the
second edit on, so check whether the spec reaches it, and if not, click it through by hand.

Manual live walkthrough (`skills/verify-ui.md`, real screens per the standing rule):

1. Make a sale to a customer named `<b>Test</b>` large enough to become the top debtor. Add 3+
   customers so the "Top 3" insight fires.
2. Confirm the name prints literally on the dashboard, and that the surrounding insight text is
   **still bold**. That proves the producer-side fix didn't escape the app's own markup.
3. Edit a bill twice, the first time with reason `<b>x</b>`, and confirm the history row prints
   it literally.

**Batch 6b — MEDIUM** (15 sites + 2 optional †, in 6 files). E2E: `girvi.spec.js` (girvi
list/detail/ledger) and `edit-bill-reports-newsale.spec.js` (Reports metal/category bars).
Manual check of screens no spec covers:

- archived girvi view
- girvi Edit modal → audit log tab
- girvi timeline modal
- product → movement history modal
- dashboard gold/silver breakdown

Regression assertions:

- `girviRiskBadge` contains `escHtml`
- no `'+e[0]+'` / `'+cat+'` / `'+m+'` in `06`'s render functions
- no `'+(l.type||'edit')+'` / `'+(e.type||'edit')+'`
- no `'+(it.purity||'')+'` in `07`

**Batch 6c — LOW** (14 display sites + 6 total-building lines, in 6 files). E2E:
`sale.spec.js`, `edit-bill-reports-newsale.spec.js` (Reports units, Edit Bill fields),
`purchase.spec.js` (bill edit), `girvi.spec.js` (renewal modal). Manual: Adjust Stock modal with
a product at qty 0. It must show "0", not blank, because that's the gotcha. Regression assertion:
no `u+=i.qty` / `+=(i.qty||1)` left in `03`/`06`.

**Batch 6d — close-out.** Re-run the full `jewelos-security-auditor` syntax-tree sweep against the
6a-6c commit set. This is the 4th time the list has been wrong after 3 confident passes, so treat
the sweep as the real test, not a formality. Then:

- update finding 2's status in both security docs, split into fixed vs. reviewed-safe-with-reason
- write a HANDOFF LOG entry
- after deploy, run `jewelos-deploy-verifier`

**Every batch, same steps:** `node --check` on changed files → `check.bat` (regression suite +
AST checks) → the e2e specs listed for that batch → `jewelos-bug-pattern-reviewer` →
`jewelos-test-runner` → an independent Opus review of that batch's diff → commit only after all of
that passes. That is 3 agents per batch, which exceeds CLAUDE.md's "at most two" cap. This uses
the same documented standing-rule exception as Batches 1-5; say so in the LOG.

## Reviewed and safe — don't touch (each with its reason)

| Suspect | Why it's safe |
|---|---|
| `09:1161` `value="'+b.pendingAmount+'"` | `pbRecalc(b)` runs first (`:1137`) and rewrites it as `Math.max(0, Math.round(...)/100)`, which is always a number |
| `07:224,230,236` girvi form `item.grossWt/netWt/qty` | `GF_ITEMS` is rebuilt from saved items through `parseFloat`/`parseInt` at `07:441` |
| `06:1141-1169` WhatsApp queue `label: rule.name+': '+g.grvNo` | it only reaches `safeConfirm()` (textContent) and the activity log (escaped, `06:802`) |
| `07:1228` `a.reason`, `08:907` `p.mode` | both are built into a `note`/`title` that is `escHtml`'d at render (`07:1235`, `08:917`) |
| `08:161` `grp.totalItems` (open item from the 22 Oct plan) | it is a `parseInt` sum (`08:132`) |
| `07:1297` `it.qty>1?' ×'+it.qty` | a `>1` number comparison is false for any string containing markup (same rule as the 22 Oct plan) |

**Crash bugs found on the way (not XSS, not in this scope; a separate ticket if Tanish wants):**

- `01:1273` `(item.weight||0).toFixed(3)` throws if `weight` is a non-empty string, and then Edit
  Bill won't open.
- `06:529` `(i.metal||'gold').toLowerCase()` throws on a non-string metal, which breaks the
  Reports metal card.
- `05:1599,1659` key a walk-in sale (no customer) as `"undefined"`, and `split('_')[0]` cuts a
  name that contains `_`. Both are display-only.

## Open questions for Tanish (blocking before execution, not before this plan)

1. **Should `normaliseData` start coercing `qty` to a number?** The original plan rejected cleaning
   data in `normaliseData` because it would silently rewrite a legitimately unusual value, like a
   custom purity string. **That reasoning mostly doesn't carry over to `qty`:**
   - `normaliseData` already coerces numeric fields this way: products' `netWt/grossWt/stockQty/mc`
     at `04:569-574`, and sale items' `grossWt/netWt/mcAmt/rate` at `04:602-605`. `qty` is the gap.
   - A non-numeric `qty` is never legitimate. Every write path stores a number (`02:1421`,
     `09:518`, `03:1542`), and `03:791,862` already treat a non-number `qty` as invalid.

   **One real catch:** turning garbage into `1` *changes* qty. The house rule says anything that
   changes qty must recompute `weight = unitWeight * qty`, and `normaliseData`'s result gets
   re-synced on the next save.

   **Recommendation:** Batch 6c's fix at the totals goes ahead regardless, because it doesn't
   depend on this answer. If you want coercion too, add it as a small separate step that only
   preserves values: turn numeric strings like `"2"` into `2`, for products and sale items only,
   and leave real garbage to the display-side escaping. That changes nothing visible, triggers no
   weight recompute, and fixes the concatenation for the only realistic bad data (numbers saved
   as strings). OK, or skip?
2. **Ship order.** May 6a go out alone as soon as it's verified? Batches 1-5 are themselves not
   yet deployed (`docs/CHANGES-batch60.md`). The simplest route is for 6a to ride that same
   deploy, with 6b/6c following.
3. **The two † sites** (`07:1000`, `08:343`). Do we fix them anyway as a one-token defence in
   depth (the default), or leave them documented as safe?
4. **Related, still open:** the CSP header at the Cloudflare Worker would limit damage from
   whatever a 4th sweep might still find. It needs your call on the allow-list (Supabase,
   Razorpay, Sentry, Google Fonts). Is it time to schedule it, given this finding has now
   reopened twice?

## Critical files

`js/01-sync-core.js` (`openEditBill` `:1233-1342`; `escHtml` `:1523`, `jsAttrEsc` `:1529`),
`js/05-auth-login.js` (`runInsightEngine` `:1533`, `buildTodayActions` `:1713`),
`js/06-inventory-stock.js` (`renderDash` `:209`, `calcCategoryPerf` `:96`,
`renderReportsIntelligence` `:509`), `js/07-settings-plans.js`, `js/08-girvi-viewmode.js`,
`js/04-orders-detail.js` (`girviRiskBadge` `:1581`, `normaliseData` `:543`),
`js/02-ui-inactivity-modals.js`, `js/03-billing-numbers.js`, `js/09-purchases.js`,
`tests/regression.test.js` (assertion pattern `:3017-3053`).
