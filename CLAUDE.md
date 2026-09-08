# JewelOS — codebase instructions

You are working on JewelOS, a jewellery shop management SaaS for Indian jewellers,
built solo by Tanish. Launch target: late September 2026.

Tanish has no coding background. Explain the reasoning, not just the fix.

## Priority framing

Does this move JewelOS closer to sellable and to the launch deadline? If not, say so
before building it.

## Before touching anything

0. **Read `HANDOFF.md` first, and write to it last.** Two Claudes work on JewelOS and
   they cannot see each other: Cowork (the chat) has the live database, Gmail, the
   Control Room and the brain folder, and none of that is visible from here. `HANDOFF.md`
   is the only thing both of us read. Claim the **NOW** line before you start, release it
   when you stop, and append a LOG entry before you hand back. A commit message does not
   reach the other side.

   **End every LOG entry with the hand-back line — always, even when it is "nothing":**

   ```
   → FOR COWORK: <the one thing to do next, or "nothing — FYI only">
   ```

   Cowork ends its entries with `→ FOR CLAUDE CODE:` the same way. A narrative
   paragraph is not a hand-back: the other side should not have to read six paragraphs
   to work out whether it is being asked for something. Writing "nothing" makes the
   silence a decision instead of an oversight, and is what stops "who did this, and what
   am I meant to do about it" from being a guess.
1. **This folder is the source of truth.** Do not go looking for a newer zip in
   `~/Downloads` — everything there is superseded. Zip *out* of here when you need to
   hand off a build; never build a fresh copy somewhere else. On 4 and 6 September two
   sessions edited batch13 in parallel without knowing, and the work had to be merged
   by hand afterwards; on 8 September a session worked a whole batch out of a Downloads
   zip and nearly shipped a build that reverted the batch14 fixes.
2. **This folder is a git repo (since 8 September).** Run `git status` first, and
   `git log --oneline -5` to see what the last session did. Commit before you hand
   back a build. If `git status` is dirty when you arrive, another session is mid-change —
   stop and ask rather than editing on top of it. That is what makes two of us safe here
   at once.
3. Read `checks/README.md`. Nine AST-based scripts that find references to things that
   were never created. Do not rebuild them.
4. If a check script references a function that does not exist here, a newer working copy
   exists somewhere. Stop and ask.

## The codebase

PWA: `index.html` plus ten numbered `js/` modules, loaded in order. ~17,800 lines.

| File | Owns |
|---|---|
| `00-config-state.js` | Supabase config, constants, the `S` state object, shared helpers |
| `01-sync-core.js` | Cloud load/save, store-proxy calls, debounced renderers |
| `02-ui-inactivity-modals.js` | Inventory item modals, sale item entry, PIN inactivity |
| `03-billing-numbers.js` | Bills, GST, sale totals, order item rows |
| `04-orders-detail.js` | Orders, the `SAAS` object, PIN key helpers, `PLAN_LIMITS` |
| `05-auth-login.js` | Login/signup, staff, Razorpay, settings panel, digest |
| `06-inventory-stock.js` | Inventory list, stock, onboarding checklist |
| `07-settings-plans.js` | Settings tabs, audit views, girvi list rendering |
| `08-girvi-viewmode.js` | Girvi detail, receipts, `cloudDiag()` |
| `09-purchases.js` | Purchase bills, suppliers, purchase→stock sync |

Never create a new module file. Grep before assuming placement — `SAAS`, `PLAN_LIMITS`
and the PIN helpers all live in the *orders* file.

Backend: Supabase project `uluzuwomwqsqxtejgzmf`, all access through Edge Functions
(`store-proxy` v6 session-token auth, `auth-gateway`, `razorpay-webhook`). No direct
PostgREST calls remain. Each shop is stored as **one JSON blob** — that single fact is
why per-module permissions and stock reservation cannot be fixed incrementally.

## Rules

See `skills/jewelos-dev-rules.md`. The short version:

- **ES5 only.** No arrow functions, `let`/`const`, template literals, `async/await`.
- **`escHtml()`** into `innerHTML`; **`jsAttrEsc()`** into inline `onclick="fn('...')"`.
- **No raw `localStorage` keys for shop state** — use `shopScopedKey()`.
- **Weight is derived**: anything changing `qty` recomputes `weight = unitWeight * qty`.
- **Do not rewrite the Girvi interest engine.** Build additive views on top of it.
- **Byte-exact edits** near `\uXXXX` escapes — use a Python read-modify-write script.

## Before handing back a build

Run `check.bat` — it does `node --check` on all ten files, the regression suite, and every
script in `checks/`. Or run them individually from `checks/`.
Compare against the previous build's output rather than reading hits as failures — most
are documented false positives. `backup-check` and `roundtrip` must pass cleanly.

Then say plainly what you could **not** verify. There is no browser automation and no
UI test coverage. Logic is verifiable; DOM behaviour is not. Never let a build sound
more tested than it is.

## Procedures

In `skills/`. Read the matching one before starting; they also exist under
`.claude/skills/` where supported, and auto-trigger there.

- `skills/jewelos-change.md` — adding or changing a feature
- `skills/jewelos-debug.md` — something is broken; the five recurring bug families
- `skills/jewelos-dev-rules.md` — the house rules in full
