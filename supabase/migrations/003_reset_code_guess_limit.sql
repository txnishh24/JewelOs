-- ══════════════════════════════════════════════════════════════════════
-- Cap wrong guesses on password-reset codes (security review 14 Sep 2026,
-- finding 1).
--
-- A reset code is 6 digits. auth-gateway's reset-password route had no
-- limit on wrong guesses, and accepted any of up to 3 live codes, so an
-- attacker who knew only an owner's email could request codes and guess
-- until one matched — full account takeover.
--
-- Now:
--   • Only the NEWEST code for an email is ever considered. Requesting a
--     new code silently retires every older one.
--   • 5 wrong guesses against that code burn it (used = true). The user
--     has to request a fresh code, which request-password-reset already
--     limits to 3 per hour — so at most 15 guesses an hour out of 900,000.
--   • The check and the counter update happen inside one locked
--     statement, so firing many guesses at once cannot slip past the cap.
--
-- Additive and idempotent. Apply BEFORE deploying the auth-gateway that
-- calls consume_password_reset_code(); the currently deployed auth-gateway
-- keeps working after this runs (it ignores the new column).
-- ══════════════════════════════════════════════════════════════════════

alter table public.password_reset_tokens
  add column if not exists failed_attempts integer not null default 0;

-- Returns true only when p_code_hash matches the newest, unused, unexpired
-- code for p_email — and consumes it. Every other outcome returns false
-- without saying why, so the caller can't tell "wrong" from "expired" from
-- "burned".
create or replace function public.consume_password_reset_code(
  p_email text,
  p_code_hash text,
  p_max_attempts integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id bigint;
  v_hash text;
  v_used boolean;
  v_expires timestamptz;
begin
  -- `for update` serialises concurrent guesses for the same email: a second
  -- caller waits here, then re-reads the row as the first caller left it
  -- (attempt count raised, or used = true).
  select id, code_hash, used, expires_at
    into v_id, v_hash, v_used, v_expires
    from password_reset_tokens
   where email = p_email
   order by created_at desc, id desc
   limit 1
   for update;

  if v_id is null or v_used or v_expires <= now() then
    return false;
  end if;

  if v_hash = p_code_hash then
    update password_reset_tokens set used = true where id = v_id;
    return true;
  end if;

  -- SET expressions see the row's old values, so this marks the code used
  -- on exactly the p_max_attempts-th wrong guess.
  update password_reset_tokens
     set failed_attempts = failed_attempts + 1,
         used = (failed_attempts + 1 >= p_max_attempts)
   where id = v_id;
  return false;
end;
$$;

revoke all on function public.consume_password_reset_code(text, text, integer) from public;
revoke all on function public.consume_password_reset_code(text, text, integer) from anon;
revoke all on function public.consume_password_reset_code(text, text, integer) from authenticated;
grant execute on function public.consume_password_reset_code(text, text, integer) to service_role;
