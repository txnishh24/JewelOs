-- 014: two small hardenings from the 7 Nov 2026 pre-release security audit. Additive; safe to run twice.
--
-- 1. store_history (013): a staff login could push the good copy out of the history with about 9
--    crafted saves (the trim kept only the newest 4). Now the trim keeps the newest 3 copies PLUS the
--    OLDEST copy taken in the last 24 hours (the "anchor"), so at most 4 are kept as before, but the
--    first good copy of the day survives however many junk copies follow. Limit: after 24 hours the
--    anchor moves forward, so a bad save must be noticed within a day.
-- 2. Entitlement accruals are owner-only in store-proxy (6 Nov, audit A3); the database trigger only
--    covered labour. It now covers ENTITLEMENT_ACCRUE too (and reversing one), so the two layers agree.
--    Entitlement SETTLE stays open to managers.

create or replace function public._store_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  k text;
  old_n integer;
  new_n integer;
  shrunk boolean := false;
begin
  foreach k in array array['sales', 'girvi', 'products', 'customers'] loop
    old_n := case when jsonb_typeof(OLD.data->k) = 'array' then jsonb_array_length(OLD.data->k) else 0 end;
    new_n := case when jsonb_typeof(NEW.data->k) = 'array' then jsonb_array_length(NEW.data->k) else 0 end;
    if old_n >= 5 and new_n * 10 < old_n * 8 then shrunk := true; end if;
  end loop;

  if shrunk or not exists (
    select 1 from store_history h where h.shop_id = OLD.id and h.created_at > now() - interval '6 hours'
  ) then
    insert into store_history (shop_id, old_version, old_data)
    values (OLD.id, coalesce((OLD.data->>'_v')::integer, 0), OLD.data);
    delete from store_history
     where shop_id = OLD.id
       and id not in (select s.id from store_history s where s.shop_id = OLD.id order by s.id desc limit 3)
       and id is distinct from (select min(a.id) from store_history a
                                 where a.shop_id = OLD.id and a.created_at > now() - interval '24 hours');
  end if;
  return NEW;
end;
$$;

revoke all on function public._store_history() from public;
revoke all on function public._store_history() from anon;
revoke all on function public._store_history() from authenticated;

create or replace function public.kg_labour_owner_only() returns trigger
language plpgsql set search_path = public as $$
declare v_target text;
begin
  if new.by_role <> 'owner' then
    if new.type in ('LABOUR_ACCRUE', 'LABOUR_PAY', 'ENTITLEMENT_ACCRUE') then
      raise exception 'labour and entitlement accrual entries are owner only' using errcode = 'KG001';
    end if;
    if new.type = 'REVERSAL' and new.reverses_id is not null then
      select type into v_target from kg_journal where id = new.reverses_id and shop_id = new.shop_id;
      if v_target in ('LABOUR_ACCRUE', 'LABOUR_PAY', 'ENTITLEMENT_ACCRUE') then
        raise exception 'reversing a labour or entitlement accrual entry is owner only' using errcode = 'KG001';
      end if;
    end if;
  end if;
  return new;
end $$;
