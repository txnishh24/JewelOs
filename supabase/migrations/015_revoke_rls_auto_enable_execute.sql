-- 015: DRAFT, NOT APPLIED. Needs Tanish's go (R29 shadow-deploy round). Safe to run twice.
--
-- Supabase's security advisor flags public.rls_auto_enable(): a SECURITY DEFINER function that anon and
-- authenticated can call through the API. Read-only facts checked on the live project (14 Nov 2026):
--   * it RETURNS event_trigger, owner postgres, used only by the event trigger "ensure_rls"
--     (ddl_command_end, tags CREATE TABLE / CREATE TABLE AS / SELECT INTO), not part of an extension;
--   * its grants are {=X/postgres, postgres, anon, authenticated, service_role}. "=X" is PUBLIC, so
--     revoking from anon and authenticated alone would change nothing: PUBLIC must be revoked too.
--   * Postgres refuses to run an event-trigger function outside the trigger system, so a direct call over
--     RPC errors today; this removes it from the API surface and clears the advisor warning.
-- Why firing is unaffected: EXECUTE is checked when the event trigger is created, not each time it fires,
-- and the function runs as its owner (SECURITY DEFINER). tests/sql-rls-auto-enable.test.mjs proves a
-- new public table still gets RLS enabled after this migration.
--
-- Rollback (restores the old grants exactly):
--   grant execute on function public.rls_auto_enable() to public, anon, authenticated;
-- Keep: postgres (owner) and service_role.

revoke execute on function public.rls_auto_enable() from public;
revoke execute on function public.rls_auto_enable() from anon;
revoke execute on function public.rls_auto_enable() from authenticated;
