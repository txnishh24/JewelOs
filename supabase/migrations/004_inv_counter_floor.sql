-- F3 step 3 (30 Sep 2026) — the invoice counter never hands out a number below
-- the shop's own "next unused invoice number".
--
-- Why: until F3, only the first sale per session asked this counter; later
-- sales used the device's local S.nextInvNo. So a shop's counter row can sit
-- far BEHIND numbers already printed on real bills (the e2e test shop: counter
-- at 30, bills up to INV-033). The F3 client skips a used number and asks
-- again, but only 5 times — a counter further behind refuses sales until it
-- catches up. This makes it catch up in one step.
--
-- How: every committed sale forward-syncs the blob's nextInvNo to (number used)
-- + 1, so store.data->'nextInvNo' is the shop's own record of the next free
-- number. The counter now returns greatest(counter + 1, that floor). The floor
-- is read server-side from the shop's saved data — nothing the client sends
-- can move it. Only 'inv_no' gets a floor; other counters behave as before.
--
-- Concurrency is unchanged: the single INSERT ... ON CONFLICT DO UPDATE still
-- row-locks the counter, so two callers can never get the same value. The
-- floor read is not locked, but a floor can only push the value UP.

create or replace function public.increment_shop_counter(p_shop_id text, p_counter text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_val integer;
  v_floor integer := 1;
  v_raw jsonb;
begin
  if p_counter = 'inv_no' then
    select data->'nextInvNo' into v_raw from store where id = p_shop_id;
    if jsonb_typeof(v_raw) = 'number' then
      v_floor := greatest(1, least((v_raw #>> '{}')::numeric, 2147483647))::integer;
    end if;
  end if;

  insert into counters (id, shop_id, counter, val, updated_at)
  values (p_shop_id || '_' || p_counter, p_shop_id, p_counter, v_floor, now())
  on conflict (id) do update
    set val = greatest(counters.val + 1, v_floor), updated_at = now()
  returning val into v_val;
  return v_val;
end;
$$;

revoke all on function public.increment_shop_counter(text, text) from public;
revoke all on function public.increment_shop_counter(text, text) from anon;
revoke all on function public.increment_shop_counter(text, text) from authenticated;
grant execute on function public.increment_shop_counter(text, text) to service_role;
