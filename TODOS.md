# TODOS

## Printable job card for Karigar jobs (deferred 4 Nov 2026)

- **What:** A print or save-as-PDF slip for a karigar job: job number, weight, purity, due date, karigar name.
- **Why:** Many workshops send a paper slip with the piece. It would make the app fit that routine.
- **Pros:** Familiar workflow. Uses job data that already exists, so no new storage.
- **Cons:** Print layout and paper sizes cannot be checked by the test suite. It needs a real printer or PDF check. No shop has asked for it yet.
- **Context:** Proposed as SCOPE-4 in the CEO review of `docs/superpowers/plans/2026-11-03-karigar-2-remaining-phases.md` and deferred by Tanish on 4 Nov 2026 (D5). Start from the job detail screen in `js/11-karigar.js` (`kg2Detail`).
- **Effort:** human M, CC S.
- **Priority:** P3
- **Depends on:** Karigar 2.0 Task 4 (the ledger must be the source of truth first).
