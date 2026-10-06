# batch49 — Edit Bill's Save button was hidden behind Customer History

Base: batch48 (not yet deployed — this zip supersedes `jewelos-batch48-DEPLOY.zip`, it
contains everything batch48 had plus the one fix below). Everything is in `index.html`.
Server side: nothing new to deploy.

## 🟢 Low (UI/CSS)

- **Edit Bill's Save/Cancel buttons were untappable on a real phone.** `#edit-bill-modal`
  and `#cust-modal` share the same `.modal-bg` CSS family and the same `z-index:500`.
  `openEditBill()` has exactly one call site in the whole codebase — a button rendered
  *inside* `#cust-modal`'s own body (Customer History) — so every time Edit Bill opened,
  the two modals tied on z-index and `#cust-modal`, being later in the page's HTML, won
  the tie and visually covered Edit Bill's own Save/Cancel buttons. Confirmed with a new
  Playwright e2e spec and a screenshot: Customer History painted over the bottom half of
  Edit Bill, exactly where Save/Cancel live. Not a batch48 regression — this CSS predates
  it; there was simply no DOM-level test exercising Edit Bill until now.

  Fixed with one CSS rule (`#cust-modal.modal-bg{z-index:490;}`) so the one modal that
  spawns the others (Edit Bill, View Bill, Refund, Add Payment all live inside Customer
  History) always sits below whichever one is currently open on top of it. Scoped to
  `#cust-modal` only — `ord-modal`/`pwd-modal`/`edit-modal` keep their existing z-index
  everywhere else they're used.

## 🧹 Testing

- New spec `tests/e2e/edit-bill-reports-newsale.spec.js` (4 tests, not shipped in this
  zip — test-only): Edit Bill live-preview/save/invoice total agreement, Day Book never
  posting a phantom "Sale" line when Old Gold is cleared to 0, Reports has no horizontal
  scroll at 390px and a refund reduces Revenue/Net Cash, and the New Sale number boxes'
  "0"-prefill fix (M4) survives a real click-and-type.

## Deliberately untouched

Everything else in batch48 is unchanged. `ord-modal`/`pwd-modal`/`edit-modal` were not
audited for the same latent stacking issue in some other combination — no evidence either
way, flagged as a maybe-pattern rather than claimed safe.

## Before you deploy

Regression suite **374/374**. All 11 `js/*.js` files syntax-clean. `check.bat` clean
against the documented baseline, `backup-check`/`roundtrip` both pass. Full e2e suite —
all 23 specs, not just the new one — **23/23**, run because this fix touches shared modal
CSS used by several other flows. Everything batch48 already needed (the two live-data
checks, Tanish's phone test) still applies; this batch doesn't remove or add to that list.
**Still not covered by any of this**: nobody has clicked through Edit Bill, Reports, or
New Sale on a real phone — this e2e suite is DOM-level only.
