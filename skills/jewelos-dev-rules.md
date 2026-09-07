# JewelOS Development Conventions

Full detail lives in the `jewelos-change` and `jewelos-debug` skills. This file is the
short version that should apply to every session touching the code.

## Non-negotiable

- **ES5 only** in `js/`. No arrow functions, `let`/`const`, template literals or
  `async/await`. Deliberate constraint for older Android WebViews in tier-2 cities.
- **Escape by context.** `escHtml()` into `innerHTML`; `jsAttrEsc()` into inline
  `onclick="fn('...')"`. Two helpers, two contexts, using the wrong one is a live XSS.
- **No raw `localStorage` keys for shop state.** Use `shopScopedKey()` from
  `00-config-state.js`. Six cross-account leaks have come from this exact mistake.
- **Weight is derived.** Anything that changes `qty` recomputes `weight = unitWeight * qty`.
- **Do not rewrite the Girvi interest engine.** Build additive views on top of it.
- **Byte-exact edits.** The codebase is full of `\uXXXX` escapes that string-replace
  tools mangle. Use a Python read-modify-write script for edits near them.

## Structure

- Ten numbered modules, loaded in order. Identify the correct existing module before
  creating anything new — never add a module file.
- Grep before assuming placement. `SAAS`, `PLAN_LIMITS` and the PIN helpers all live in
  the *orders* file.

## Process

- Changes: locate the module, patch narrowly, run the checks, ship a zip with a changelog.
- Debugging: reproduce, isolate to one module, patch. Do not rewrite whole files unless
  asked. Get a real symptom from Tanish first rather than guessing.
- Server-side changes: the Edge Function and the client must deploy **together**. Either
  alone breaks sync.

## Honesty about verification

Logic is verifiable here; DOM behaviour is not. There is no browser automation and no UI
test coverage. Always state which category a fix falls into and what remains untested.

## Priority framing

Does this move JewelOS closer to sellable and to the launch deadline? If not, flag it as
a distraction before building it.
