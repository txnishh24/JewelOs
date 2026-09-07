-- ══════════════════════════════════════════════════════════════════════
-- JewelOS P0 hardening pass (Aug 2026) — atomic counters + true CAS writes
--
-- Fixes two issues the July 21 lockdown (001_lockdown_rls.sql) did not
-- cover, because they predate store-proxy having any server-side
-- transaction logic at all:
--
-- 1. COUNTERS TABLE WAS NEVER LOCKED DOWN.
--    js/00-... never created it via migration — it was only ever created
--    by the "SQL Setup" block shown in Settings → Data, which (until this
--    pass) shipped `CREATE POLICY ... TO anon USING (true)`. Any shop that
--    ran that setup SQL has a `counters` table wide open to the public
--    anon key — the exact tenant-isolation hole 001_lockdown_rls.sql
--    closed for `store` and `auth_store`. This migration closes it here
--    too and brings `counters` under the same service-role-only model.
--
-- 2. NEITHER read-then-write PATTERN WAS ACTUALLY ATOMIC.
--      - js/01-sync-core.js's old getNextCounter() did GET current val,
--        then POST val+1 as two separate REST calls — two concurrent
--        devices can both read val=100 and both write val=101.
--      - store-proxy's old PUT handler did SELECT current row, compare
--        version in application code, then UPSERT — two concurrent
--        requests can both pass the version check before either writes
--        (classic check-then-act race), silently losing one device's
--        save despite the "conflict detection" already in place.
--    Both are replaced with single-statement Postgres functions below.
--    A single SQL statement (INSERT ... ON CONFLICT, or UPDATE ... WHERE
--    executed after SELECT ... FOR UPDATE) is atomic with respect to
--    other transactions because Postgres holds the row lock for the
--    statement's own duration — there is no window for a second session
--    to read stale state in between.
-- ══════════════════════════════════════════════════════════════════════

-- ── COUNTERS TABLE — lock down like store/auth_store ───────────────────
create table if not exists public.counters (
  id text primary key,          -- '<shop_row_key>_<counter_name>'
  shop_id text not null,
  counter text not null,
  val integer not null default 0,
  updated_at timestamptz not null default now()
);
create index if not exists idx_counters_shop on public.counters(shop_id);

alter table public.counters enable row level security;
-- Default-deny, same as store/auth_store: no anon/authenticated policies.
-- Only service_role (used exclusively by store-proxy) may touch this
-- table, and only through the increment_shop_counter() function below —
-- store-proxy never issues a raw SELECT/INSERT against `counters` itself.
revoke all on public.counters from anon;
revoke all on public.counters from authenticated;

-- ── ATOMIC COUNTER INCREMENT ────────────────────────────────────────────
-- One statement: INSERT ... ON CONFLICT DO UPDATE SET val = val + 1.
-- Postgres resolves conflicting concurrent inserts/updates against the
-- same primary key by taking a row lock for the duration of this single
-- statement, so two simultaneous callers are serialized by the database
-- itself — never both reading the pre-increment value.
create or replace function public.increment_shop_counter(p_shop_id text, p_counter text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_val integer;
begin
  insert into counters (id, shop_id, counter, val, updated_at)
  values (p_shop_id || '_' || p_counter, p_shop_id, p_counter, 1, now())
  on conflict (id) do update
    set val = counters.val + 1, updated_at = now()
  returning val into v_val;
  return v_val;
end;
$$;

revoke all on function public.increment_shop_counter(text, text) from public;
revoke all on function public.increment_shop_counter(text, text) from anon;
revoke all on function public.increment_shop_counter(text, text) from authenticated;
grant execute on function public.increment_shop_counter(text, text) to service_role;

-- ── TRUE ATOMIC COMPARE-AND-SWAP FOR THE `store` BLOB ───────────────────
-- Replaces store-proxy's old "SELECT current row, compare version in
-- TypeScript, then UPSERT" sequence — two separate round-trips with a
-- race window between them — with one function that does the read (with
-- a row lock), the version compare, and the write inside a single
-- Postgres statement/transaction.
--
-- `for update` takes an exclusive lock on the shop's row (if it exists)
-- for the rest of this transaction, so a second concurrent call for the
-- same shop_id blocks until the first commits — it cannot read the
-- pre-write version and race ahead.
--
-- Returns one row:
--   ok = true            -> write succeeded, new_data has the saved payload
--   ok = false, conflict  -> version didn't match; current_data has what's
--                            actually stored, so the caller can show it
--                            without a second round trip
create or replace function public.store_cas_write(
  p_shop_id text,
  p_data jsonb,
  p_expected_version integer
)
returns table(ok boolean, conflict boolean, new_data jsonb, current_data jsonb)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing jsonb;
  v_current_version integer;
  v_updated jsonb;
begin
  select data into v_existing from store where id = p_shop_id for update;

  if v_existing is null then
    -- Brand-new shop row. Only valid if the client had no prior version.
    if p_expected_version <> 0 then
      return query select false, true, null::jsonb, null::jsonb;
      return;
    end if;
    v_updated := p_data || jsonb_build_object('_v', 1);
    insert into store (id, data, updated_at) values (p_shop_id, v_updated, now());
    return query select true, false, v_updated, null::jsonb;
    return;
  end if;

  v_current_version := coalesce((v_existing->>'_v')::integer, 0);
  if v_current_version <> p_expected_version then
    return query select false, true, null::jsonb, v_existing;
    return;
  end if;

  v_updated := p_data || jsonb_build_object('_v', v_current_version + 1);
  update store set data = v_updated, updated_at = now() where id = p_shop_id;
  return query select true, false, v_updated, null::jsonb;
end;
$$;

revoke all on function public.store_cas_write(text, jsonb, integer) from public;
revoke all on function public.store_cas_write(text, jsonb, integer) from anon;
revoke all on function public.store_cas_write(text, jsonb, integer) from authenticated;
grant execute on function public.store_cas_write(text, jsonb, integer) to service_role;

-- ── NOTES ────────────────────────────────────────────────────────────
-- This migration is additive and idempotent (CREATE ... IF NOT EXISTS /
-- CREATE OR REPLACE FUNCTION), safe to rerun, and does not touch or
-- delete any existing row in `store`, `auth_store`, or `counters`.
-- Deploy AFTER 001_lockdown_rls.sql and the updated store-proxy function
-- (see supabase/functions/store-proxy/index.ts), and BEFORE relying on
-- js/01-sync-core.js's new getNextCounter() implementation, which now
-- calls store-proxy instead of hitting `counters` directly with the anon
-- key.
