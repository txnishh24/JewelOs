# Plugin routing (installed 18 Nov 2026) - pre-approved, run without asking

Tanish's standing rule (18 Nov 2026): he has no time to run these himself. Claude Code and Cowork run them
whenever a row below matches. Same rules as `.claude/rules/agents.md`: only what the task needs, no duplicate on the same diff,
and `jewelos-*` agents win on `js/` diffs.

- **Every edit** -> `Security Guidance` (plugin hooks, automatic; nothing to invoke).
- **Before any release, or after a change to auth, session, `store-proxy`, `auth-gateway`, `paidUntil`, role-check or anything written with `innerHTML`** -> `claude-security` scan, scoped to the changed files or directory, as a second opinion after `jewelos-security-auditor` (not instead of it). A full-repo scan: before launch, or when Tanish asks. It uses a lot of tokens: pick the lowest effort tier that fits, run it once, never loop it.
- **Any change under `supabase/functions/`** -> `42crunch-audit` on an OpenAPI spec made by `generate-oas` (keep the spec in `docs/`). `42crunch-setup` needs a 42Crunch account and token from Tanish: until he gives one, skip this row and say so in the LOG entry. `42crunch-scan` (live) runs only against E2E shop `77c4aefe`, never a customer shop.
- **Cowork only: Tanish names a prospect, a jeweller meeting or asks for a pricing/landing page** -> `Sales Enablement Kit` (`demo-runbook`, `call-coaching`, `rep-certification`) and `Website Copywriting and Positioning` (`brand-voice`, `landing-page-copy`, `copy-proof-check`). Never invent testimonials or customers: there are none yet.
- **Cowork only: checking the live worker** -> the Cloudflare connector, read-only (`workers_list`, `workers_get_worker`), as an extra to `jewelos-deploy-verifier`. The connector is deprecated and cannot deploy; deploys stay `npx wrangler deploy` by Claude Code on Tanish's word. Never create or delete KV, D1, R2 or Hyperdrive through it.

**Still needs Tanish's yes:** applying a `claude-security` patch file to auth, payment, RLS or store-proxy code; any deploy; adding the PostHog SDK to the client (a third-party SDK, customer data leaves the app, ES5 and CSP impact; Sentry already captures crashes, so PostHog would only add usage analytics); any scan or test against a customer shop's data; an unattended full-repo `claude-security` run.

Every run is one line in the HANDOFF LOG entry: what ran, what it found, what was not run and why.
