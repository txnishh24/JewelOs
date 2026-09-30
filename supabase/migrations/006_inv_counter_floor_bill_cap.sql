-- 006 (30 Sep 2026) — a single bill far above the counter can't jump the series.
-- Replaces 005's function; same floor rule plus one cap.
--
-- Why (Opus review of 005, LOW): 005's floor is (highest INV-<digits> bill) + 1,
-- read from store.data, which any logged-in user of the shop can write. One
-- crafted bill "INV-999999999" (a staff PUT, or an old cached app that didn't
-- refuse a typo) moved the counter to 1e9 for good.
--
-- How: once a shop HAS a counter row, only bills at most 1000 above it count
-- toward the floor; a bill further ahead is left out (so real bills below it
-- still count — ignoring the whole floor would re-offer INV-031 when a crafted
-- INV-999999999 sat next to a real INV-031). This does not bring back the lag problem 005 fixed:
-- every invoice number is now issued by this counter (the app no longer
-- makes its own), so a live counter can't fall more than a few behind the
-- real bills — Cowork's check on 30 Sep found a largest gap of 3. The first
-- call for a shop (no row yet — e.g. a shop restored from a backup) still takes
-- the full floor. If the counter later reaches an ignored bill's number, the
-- app sees it is used and asks again (invNoInUse / allocInvNo).
--
-- Concurrency: unchanged (INSERT ... ON CONFLICT row lock).

create or replace function public.increment_shop_counter(p_shop_id text, p_counter text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  c_max_jump constant integer := 1000;
  v_val integer;
  v_floor integer := 1;
  v_cur integer;
begin
  if p_counter = 'inv_no' then
    -- Unlocked read: a stale (lower) value only narrows the window; the
    -- upsert below still uses the locked counters.val.
    select val into v_cur from counters where id = p_shop_id || '_' || p_counter;
    select coalesce(max((m[1])::integer), 0) + 1 into v_floor
    from store s
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(s.data->'sales') = 'array' then s.data->'sales' else '[]'::jsonb end) e
    cross join lateral regexp_match(btrim(e->>'invNo'), '^INV-0*([0-9]{1,9})$', 'i') m
    where s.id = p_shop_id
      and (v_cur is null or (m[1])::integer <= v_cur + c_max_jump);
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
