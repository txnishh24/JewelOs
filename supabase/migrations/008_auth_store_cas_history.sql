-- ══════════════════════════════════════════════════════════════════════
-- JewelOS — auth_store compare-and-swap + history (10/11 Oct 2026 Phase 5,
-- items 7 and 8, bundled per that plan's explicit instruction)
--
-- `auth_store` has two rows, id='users' and id='shops', and each row's
-- `data` is a JSON ARRAY holding every user or every shop on the whole
-- platform (not per-shop like `store`). `getBlob`/`putBlob`
-- (supabase/functions/auth-gateway/index.ts) do a whole-array
-- read-modify-write with no lock and no version check -- the same bug
-- class store_cas_write (002) already fixed for the per-shop `store`
-- table, but never applied here. Two overlapping writes (e.g. a
-- remove-staff for one shop and a signup landing for an unrelated shop)
-- and whichever `putBlob` lands SECOND silently overwrites the first's
-- change, for the WHOLE system, not just one shop.
--
-- Separately: there is no history for a destructive whole-blob overwrite
-- to `auth_store` (migration 007's manual-edit guard only covers `store`).
--
-- Full design, alternatives considered and rejected, and the reasoning
-- behind every choice below: docs/auth-store-cas-audit-design.md (Opus
-- design, 11 Oct 2026). NOTE that doc's own section 2: HANDOFF's item 8
-- literally names `store_history` for the `store` table, not `auth_store`
-- -- that is a SEPARATE, larger, not-yet-built follow-up (full snapshots
-- of `store` at today's save rate would run ~3GB/shop/month, pending
-- Tanish's cost call). What ships here is `auth_store`'s own history,
-- which is cheap (auth writes are rare, the blob is small).
--
-- Chosen design: keep the shared array (restructuring to one row per user/
-- shop is the "right" end state but a much larger migration, rejected for
-- now -- see design doc section 3), optimistic CAS via a NEW `version`
-- COLUMN (not a `_v` key inside the array -- `data` is an array, and
-- `array || object` would append a fake user, unlike store_cas_write's
-- object-shaped `data`). History is captured by a BEFORE UPDATE trigger,
-- not a second insert inside the CAS function, specifically so it ALSO
-- catches writers that don't go through auth_store_cas_write yet: the
-- legacy `putBlob` upsert between this migration landing and auth-gateway's
-- redeploy, and `razorpay-webhook`'s own raw `.update()` (deliberately not
-- migrated to the new helper this pass -- see HANDOFF). Those show up with
-- `actor IS NULL`, the same "untracked write" signal 007 uses.
--
-- Additive and idempotent (CREATE/ALTER ... IF NOT EXISTS, CREATE OR
-- REPLACE FUNCTION, DROP TRIGGER IF EXISTS before CREATE), safe to rerun.
-- The currently deployed auth-gateway and razorpay-webhook keep working
-- unmodified after this applies -- their writes just start getting a
-- version bump and a history row (actor NULL) immediately, before any
-- function redeploy. The new `auth_store_cas_write` RPC isn't called by
-- anything until auth-gateway's `mutateBlob` helper (a later commit) is
-- deployed, so apply this BEFORE that deploy, not after.
-- ══════════════════════════════════════════════════════════════════════

-- ── 1. version column ───────────────────────────────────────────────────
alter table public.auth_store
  add column if not exists version integer not null default 0;

-- ── 2. history table ────────────────────────────────────────────────────
-- Holds password hashes, salts and every shop's rowKey (the store-proxy
-- bearer secret), exactly as sensitive as auth_store itself: same lockdown.
create table if not exists public.auth_store_history (
  id bigint generated always as identity primary key,
  row_id text not null,            -- 'users' | 'shops'
  old_version integer not null,
  new_version integer not null,
  old_data jsonb,                  -- the array as it was BEFORE this write
  actor text,                      -- '<function>:<route>:<userId>'; NULL = not via
                                    -- auth_store_cas_write (direct SQL edit or an
                                    -- un-migrated writer). Same idea as 007's 'manual-'.
  created_at timestamptz not null default now()
);
create index if not exists auth_store_history_time_idx
  on public.auth_store_history (created_at);
alter table public.auth_store_history enable row level security;
revoke all on public.auth_store_history from anon;
revoke all on public.auth_store_history from authenticated;

-- ── 3. history + version trigger: fires for EVERY data-changing update ──
-- CAS function, legacy upsert, razorpay-webhook, Cowork's manual SQL alike.
create or replace function public._auth_store_history()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Always OLD+1, whatever the writer put in NEW.version: the version can
  -- never go backwards or be forged by a manual edit (same rule as 007).
  NEW.version := OLD.version + 1;
  insert into auth_store_history (row_id, old_version, new_version, old_data, actor)
  values (OLD.id, OLD.version, NEW.version, OLD.data,
          nullif(current_setting('jewelos.actor', true), ''));
  -- Retention: auth writes are rare, so pruning here costs nothing and
  -- needs no pg_cron. If nothing is written for 30+ days, old rows simply
  -- wait for the next write. Harmless.
  delete from auth_store_history where created_at < now() - interval '30 days';
  return NEW;
end;
$$;
revoke all on function public._auth_store_history() from public;
revoke all on function public._auth_store_history() from anon;
revoke all on function public._auth_store_history() from authenticated;

drop trigger if exists _auth_store_history on public.auth_store;
create trigger _auth_store_history
  before update on public.auth_store
  for each row
  when (OLD.data is distinct from NEW.data)
  execute function public._auth_store_history();

-- ── 4. CAS write: store_cas_write's shape, for a whole-array row ────────
create or replace function public.auth_store_cas_write(
  p_id text,
  p_data jsonb,
  p_expected_version integer,
  p_actor text
)
returns table(ok boolean, conflict boolean, cur_version integer, current_data jsonb)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing jsonb;
  v_version integer;
begin
  if p_id not in ('users', 'shops') then
    raise exception 'auth_store_cas_write: unknown row %', p_id;
  end if;
  -- An object/null here would replace every account on the platform.
  if jsonb_typeof(p_data) is distinct from 'array' then
    raise exception 'auth_store_cas_write: data must be a JSON array';
  end if;

  select a.data, a.version into v_existing, v_version
    from auth_store a where a.id = p_id
    for update;

  if not found then
    -- Fresh database only; production rows exist. Mirrors 002.
    if p_expected_version <> 0 then
      return query select false, true, 0, null::jsonb;
      return;
    end if;
    insert into auth_store (id, data, version) values (p_id, p_data, 1);
    return query select true, false, 1, null::jsonb;
    return;
  end if;

  if v_version <> p_expected_version then
    -- Hand back what's actually stored, so the caller can re-apply its
    -- change without a second round trip (same as 002's current_data).
    return query select false, true, v_version, v_existing;
    return;
  end if;

  -- ponytail: every legitimate route adds or removes at most ONE record per
  -- write. Refusing a bigger drop turns a client/route bug that would wipe
  -- the platform's logins into a 500 instead. Bulk cleanups are manual SQL,
  -- which doesn't go through this function.
  if jsonb_typeof(v_existing) = 'array'
     and jsonb_array_length(p_data) < jsonb_array_length(v_existing) - 1 then
    raise exception 'auth_store_cas_write: refusing to drop % records from % in one write',
      jsonb_array_length(v_existing) - jsonb_array_length(p_data), p_id;
  end if;

  -- Transaction-local: visible to the trigger below, gone at commit.
  perform set_config('jewelos.actor', coalesce(p_actor, ''), true);
  update auth_store a set data = p_data where a.id = p_id
    returning a.version into v_version;   -- post-trigger value (old + 1)
  return query select true, false, v_version, null::jsonb;
end;
$$;

revoke all on function public.auth_store_cas_write(text, jsonb, integer, text) from public;
revoke all on function public.auth_store_cas_write(text, jsonb, integer, text) from anon;
revoke all on function public.auth_store_cas_write(text, jsonb, integer, text) from authenticated;
grant execute on function public.auth_store_cas_write(text, jsonb, integer, text) to service_role;

-- ── NOTES ────────────────────────────────────────────────────────────
-- Manual verification (run wrapped in `begin; ... rollback;` against a
-- disposable test row, matching migration 007's own verification style):
--
--   begin;
--
--   -- 1. Stale version must conflict and hand back the live array:
--   select * from auth_store_cas_write('users', (select data from auth_store where id='users'), -1, 'test:probe');
--   -- expect: ok=false, conflict=true, cur_version = the live version, current_data populated
--
--   -- 2. A manual update (no function) still bumps version and logs actor NULL:
--   update auth_store set data = data where id = 'shops';
--   select actor, old_version, new_version from auth_store_history order by id desc limit 1;
--   -- expect: actor IS NULL, new_version = old_version + 1
--
--   rollback;
--
--   -- 3. After applying for real, confirm both rows start at version 0 and
--   -- no history exists yet:
--   select id, version from auth_store;
--   select count(*) from auth_store_history;
--
-- Rollback, if ever needed (the version column and history table can stay,
-- they're harmless on their own):
--   drop trigger if exists _auth_store_history on public.auth_store;
--   drop function if exists public.auth_store_cas_write(text, jsonb, integer, text);
