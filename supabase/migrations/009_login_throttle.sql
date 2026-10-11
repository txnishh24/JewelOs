-- ══════════════════════════════════════════════════════════════════════
-- Login lockout: atomic, and a stranger can't lock an owner out of their
-- own phone (HANDOFF 10 Oct Phase 5, item 6; docs/login-lockout-design.md).
--
-- auth-gateway's login route used to COUNT recent failures in
-- login_attempts, check the password, and only THEN insert this attempt.
-- Parallel requests all read the same old count, so 50 guesses fired at
-- once all got past a "5 attempts" limit. And the count was keyed on
-- email alone, so anyone who knew an owner's email could lock them out
-- for 15 minutes, again and again, without knowing the password.
--
-- Now:
--   • One row per throttle key. The key is 'e:<email>' for a device that
--     has never signed in to that email, or 'd:<email>|<device id>' for a
--     device holding a signed device token for it (auth-gateway checks the
--     signature; this table never sees the token).
--   • login_throttle_take() counts the attempt and decides inside one
--     locked statement, BEFORE the password is checked. A correct password
--     then deletes the row. Firing many guesses at once cannot slip past.
--   • Every 5th counted attempt starts a lock: 15 min, then 30, 60 ... up
--     to 24 h. Attempts during a lock are refused and NOT counted. A full
--     24 h of quiet after the last attempt or lock forgets the key.
--   • login_attempts is untouched: still one row per checked attempt, as
--     an audit log. Nothing reads it to decide anything any more.
--
-- Rejected alternatives (full reasoning: docs/login-lockout-design.md
-- sections 3.1-3.2): keying on email+IP (defeated by IP rotation, and
-- rests on an unverified assumption about x-forwarded-for at Supabase's
-- edge); a growing per-email delay with no hard lock (doesn't defeat a
-- script that fires the instant each slot opens, and weakens the cap
-- against a determined guesser).
--
-- Additive and idempotent. Apply BEFORE deploying the auth-gateway that
-- calls login_throttle_take() — that version refuses every login (503) if
-- the function is missing. The currently deployed auth-gateway keeps
-- working after this runs (it never touches the new table). Apply AFTER
-- 008 (auth_store CAS + history) is confirmed live — numbering order
-- resolved in docs/login-lockout-design.md's top-of-file note, since this
-- doc and docs/auth-store-cas-audit-design.md were designed in parallel
-- and both independently claimed migration number 008.
-- ══════════════════════════════════════════════════════════════════════

create table if not exists public.login_throttle (
  key text primary key,
  failures integer not null default 0,        -- counted attempts since the last lock
  lockouts integer not null default 0,        -- locks in a row without a success: 15 * 2^n min
  locked_until timestamptz,
  last_attempt_at timestamptz not null default now()
);
alter table public.login_throttle enable row level security;
-- Default-deny, same as login_attempts: only service_role (auth-gateway).
revoke all on public.login_throttle from anon;
revoke all on public.login_throttle from authenticated;

-- Returns 0 when this attempt may go ahead (it has been counted), or the
-- number of seconds until p_key's lock lifts (nothing counted). Says
-- nothing about whether the email has an account.
create or replace function public.login_throttle_take(
  p_key text,
  p_max_failures integer,
  p_base_lock_min integer,
  p_max_lock_min integer
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_failures integer;
  v_lockouts integer;
  v_locked_until timestamptz;
  v_last timestamptz;
  v_lock_min integer;
begin
  -- Make sure there is a row to lock. If a parallel call is inserting the
  -- same key, this waits for that insert, then does nothing.
  insert into login_throttle (key) values (p_key)
  on conflict (key) do nothing;

  -- `for update` serialises concurrent attempts for the same key: a second
  -- caller waits here, then re-reads the row as the first caller left it
  -- (count raised, or locked).
  select failures, lockouts, locked_until, last_attempt_at
    into v_failures, v_lockouts, v_locked_until, v_last
    from login_throttle
   where key = p_key
   for update;

  -- Still locked: refuse WITHOUT counting, so hammering during a lock
  -- neither extends it nor makes the next one longer.
  if v_locked_until > now() then
    return greatest(1, ceil(extract(epoch from v_locked_until - now()))::integer);
  end if;

  -- A full max-lock period (24 h) of quiet since the last attempt AND since
  -- the last lock ended: start over. greatest() ignores a null locked_until.
  if greatest(v_last, v_locked_until) <= now() - make_interval(mins => p_max_lock_min) then
    v_failures := 0;
    v_lockouts := 0;
  end if;

  v_failures := v_failures + 1;

  if v_failures >= p_max_failures then
    -- This last allowed attempt still goes ahead — it may be the right
    -- password, and a success deletes this row, lock and all. Everything
    -- after it is refused until the lock lifts. 15, 30, 60 ... capped.
    v_lock_min := least(p_max_lock_min,
                        p_base_lock_min * (2 ^ least(v_lockouts, 16))::integer);
    v_locked_until := now() + make_interval(mins => v_lock_min);
    v_lockouts := v_lockouts + 1;
    v_failures := 0;
  end if;

  update login_throttle
     set failures = v_failures,
         lockouts = v_lockouts,
         locked_until = v_locked_until,
         last_attempt_at = now()
   where key = p_key;
  return 0;
end;
$$;

revoke all on function public.login_throttle_take(text, integer, integer, integer) from public;
revoke all on function public.login_throttle_take(text, integer, integer, integer) from anon;
revoke all on function public.login_throttle_take(text, integer, integer, integer) from authenticated;
grant execute on function public.login_throttle_take(text, integer, integer, integer) to service_role;

-- ── NOTES ────────────────────────────────────────────────────────────
-- Additive and idempotent (IF NOT EXISTS / CREATE OR REPLACE), safe to
-- rerun. Touches no existing table; login_attempts keeps its rows and its
-- role as the audit log.
--
-- Support: an owner stuck on a new device who can't use Forgot Password
--   delete from login_throttle where key = 'e:<their email, lowercase>';
-- Housekeeping, only if the table ever grows large:
--   delete from login_throttle
--    where greatest(last_attempt_at, locked_until) < now() - interval '2 days';
-- Rollback: redeploy the previous auth-gateway. Then, optionally:
--   drop function if exists public.login_throttle_take(text, integer, integer, integer);
--   drop table if exists public.login_throttle;
