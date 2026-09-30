-- 005 (30 Sep 2026) — the invoice counter's floor comes from the shop's actual
-- bills, not from the saved "next invoice number". Replaces 004's function.
--
-- Why (Cowork's Opus review of 004, items 1 and 2):
--   1. 004 read store.data->'nextInvNo'. A bad value there (an old client's
--      typed number, a restored backup) was ignored while >1000 ahead — but
--      never went away, so once the counter came within 1000 of it, one sale
--      jumped ~1000.
--   2. An honest lag of more than 1000 (or a shop with >1000 bills and no
--      counter row, e.g. restored from a backup) made 004 ignore the floor,
--      and the client refused every sale after skipping 5 used numbers.
--
-- How: the floor is (highest INV-<digits> invoice number actually on a bill
-- in this shop) + 1. That is exactly the number that can't collide, whatever
-- the lag, and nextInvNo is no longer read at all. Only numbers in the format
-- this counter issues count ("INV-031"; case, spaces and leading zeros
-- ignored) — a typed "2025-26/001" is not in that format and moves nothing.
-- At most 9 digits are read, so floor <= 1e9 and counters.val + 1 cannot
-- overflow because of it (004's val + 1000 could, above 2147482647).
--
-- Trust: sales live in store.data, which any logged-in user of the shop can
-- write. The worst a bad bill can do is move the series forward (a gap) —
-- never a duplicate, never an error. The app refuses a typed INV- number far
-- above the series (js/02 recordSale), so it can't create one by accident.
--
-- Cost: one pass over the shop's sales per counter call (one per sale).
-- ponytail: fine at thousands of bills; keep a max-bill column if it shows up.
--
-- Concurrency: unchanged from 002/004 — the INSERT ... ON CONFLICT row lock
-- serialises callers; the floor read is unlocked but can only push UP.

create or replace function public.increment_shop_counter(p_shop_id text, p_counter text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_val integer;
  v_floor integer := 1;
begin
  if p_counter = 'inv_no' then
    select coalesce(max((m[1])::integer), 0) + 1 into v_floor
    from store s
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(s.data->'sales') = 'array' then s.data->'sales' else '[]'::jsonb end) e
    cross join lateral regexp_match(btrim(e->>'invNo'), '^INV-0*([0-9]{1,9})$', 'i') m
    where s.id = p_shop_id;
    v_floor := coalesce(v_floor, 1);
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
