# JewelOS — model switching and usage policy

Tanish's rule, 9 September 2026. Applies to Claude Code **and** Cowork.

Use the right model for the right work. **Do not use Opus for everything by default.**
Optimise for the best overall result, not the most powerful model.

```
Sonnet → build      Opus → think deeply
Sonnet → implement  Opus → review high-risk work
```

---

## 1. Sonnet is the default

Day-to-day JewelOS development runs on Sonnet:

feature development · UI/UX · bug fixes · CRUD · forms and validation · database queries ·
Supabase work · API integration · invoice generation · inventory · sales · purchases ·
girvi workflows · ledger changes · authentication changes · routine refactoring · writing
and fixing tests · normal QA · performance · documentation · small-to-medium changes

Do not escalate routine work to Opus.

## 2. Opus for genuine reasoning

**Architecture** — major decisions, new modules, cross-module restructuring, large refactors,
data-model redesign, multi-module dependency analysis.

**Hard bugs** — anything Sonnet couldn't resolve, bugs spanning interconnected modules, race
conditions, complex state problems, difficult Supabase issues, data corruption or integrity
concerns, auth/authorisation security issues, unclear root cause.

**Production and business-critical** — production-readiness audits, security audits,
data-integrity audits, migration planning, launch-readiness review, payment and financial
workflows, and judging whether a change could break existing customers or data.

**Strategic planning** — when the task needs the whole architecture understood first.

## 3. Preferred workflow for anything large

1. **Opus** — read the architecture, inspect the modules, find the dependencies, name the
   risks and edge cases, design the safest solution, write the plan.
2. **Sonnet** — implement the approved plan, change the files, run the tests, fix what
   breaks, verify, report exactly what changed.
3. **Opus again, only if** Sonnet is stuck, tests keep failing unexpectedly, the work exposes
   an architectural problem, the change touches financial or data workflows, or a final deep
   review is warranted.

## 4. Do not switch at random

Not a reason to reach for Opus: the task is long, there are many files, the user asked for a
feature, or the code looks complicated at a glance. Work out whether it actually needs deeper
reasoning first.

Equally: don't let Sonnet grind. **After one or two serious failed attempts on a hard
problem, reassess.**

## 5. The two roles

| | |
|---|---|
| **Sonnet** | Senior developer — implementation, bug fixing, testing, refactoring, routine work |
| **Opus** | Principal engineer — architecture, complex reasoning, difficult debugging, security, data integrity, high-risk calls, final critical review |

Don't put the principal engineer on routine coding.

## 6. Claude Code

- **Default:** Sonnet with a strong reasoning/effort level.
- **Major feature:** Opus plan → Sonnet implementation. Where available, `opusplan` is the
  preferred mode — deeper planning, efficient implementation.
- **Escalate to Opus when:** Sonnet is stuck, root cause is unclear, modules interact
  unexpectedly, data integrity is at risk, security is involved, architecture must change.
- **Final review:** Opus, for critical releases.

## 7. Cowork

- **Sonnet:** routine file operations, documentation, organisation, repetitive tasks, normal
  QA workflows, data and document processing, project maintenance, routine research.
- **Opus:** full audits, complex project analysis, architecture review, production-readiness
  analysis, deep QA strategy, cross-file reasoning, high-risk business workflow analysis,
  finding hidden problems before launch.

Cowork should not automatically use Opus either.

## 8. Classify the risk before starting

| | Model | Examples |
|---|---|---|
| 🟢 **Low** | Sonnet | UI change, button fix, form validation, small bug, styling, simple feature |
| 🟡 **Medium** | Sonnet, escalate if needed | New workflow, inventory/sales/purchase changes, moderate database changes, cross-module feature |
| 🔴 **High** | Opus for analysis and planning | Financial calculations, girvi interest, ledger logic, inventory or data migration, auth/security, schema changes, large refactors, production deployment, customer-data integrity, major architecture |

## 9. Never trade data integrity for speed

JewelOS holds business-critical records. For anything touching inventory, sales, purchases,
suppliers, customers, girvi, interest, ledger, payments, outstanding balances, invoices or
historical records, the order of priority is:

1. Preserve existing data
2. Correct calculations
3. Backward compatibility
4. Transaction consistency
5. Testing
6. Safe migration
7. Auditability

**If uncertain, stop and analyse before touching production-critical logic.**

---

## Notes added by Cowork, 9 Sep — not part of Tanish's policy

Four things the policy doesn't say, offered because they're where it will get misapplied.

**Risk beats size.** §8 classifies by task type, and §4 rightly says length isn't a reason to
escalate. The inverse trap is worse and isn't written down: a *one-line* change to girvi
interest or a ledger balance is a small task at high risk. Size determines effort; risk
determines model. When they disagree, risk wins.

**Whoever implements still writes the HANDOFF entry.** The hand-back line is a judgment about
what the other side needs to know — reasoning, not typing. A Sonnet session that ships code
still owes a proper entry. Don't defer it to "an Opus session later"; by then the context is
gone.

**Deploying isn't the risky part — verifying is.** §8 lists "production deployment" as high
risk, but the deploy itself is Tanish dragging a zip; no model is involved. The high-risk
work is checking afterwards that what's live is what was built. On 9 Sep the site came back
serving new JavaScript on top of old HTML, and nothing in the build pipeline would have
caught it. **Post-deploy verification is Opus work.**

**The real reason this policy exists.** Claude Pro has a finite Opus budget. Spending it on
routine work means not having it at 11pm when a girvi interest figure disagrees with a
jeweller's bahi-khata the night before a demo. The constraint isn't cost, it's *availability
at the moment it matters*.
