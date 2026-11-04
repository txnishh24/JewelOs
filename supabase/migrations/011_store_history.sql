-- 011: keep recent copies of each shop's data blob (audit 4 Nov, finding 1).
--
-- WHY: store_cas_write (002) replaces the whole blob on every save and keeps no old copy. A client
-- bug that saves a shrunken blob at the right version erased a shop for good. auth_store already
-- has this safety net (008); the much more valuable `store` table did not.
--
-- WHAT: before any update that changes a shop's data, copy the OLD blob into store_history when
--   (a) this shop has no copy from the last 6 hours, or
--   (b) the new blob has clearly lost records (any of sales/girvi/products/customers that held
--       5 or more records now holds under 80% of them) -- the "bad save" case, always captured.
-- Only the newest 4 copies per shop are kept, so the table stays bounded (a 0.5 MB shop = ~2 MB;
-- a 2.5 MB shop = ~10 MB). Raise/lower the two numbers below if the Free-plan 500 MB gets tight.
--
-- RESTORE (manual, service role, after looking at the rows):
--   select id, old_version, created_at, jsonb_array_length(old_data->'sales') from store_history
--    where shop_id = '<rowKey>' order by id desc;
--   update store set data = (select old_data from store_history where id = <id>) where id = '<rowKey>';
-- (The 007 guard trigger bumps _saveId/_v on a manual edit, so open phones reload it.)
-- NEVER set _v lower than the current value, and never delete and re-insert a shop row: store-proxy
-- answers "unchanged" to any phone whose version equals the stored _v, so those phones would stay stale.
--
-- Nothing is deleted from store and no client changes: this only adds a table and a trigger.

create table if not exists public.store_history (
  id          bigint generated always as identity primary key,
  shop_id     text    not null,
  old_version integer not null,
  old_data    jsonb   not null,
  created_at  timestamptz not null default now()
);
create index if not exists store_history_shop_idx on public.store_history (shop_id, id desc);
alter table public.store_history enable row level security;
revoke all on public.store_history from anon;
revoke all on public.store_history from authenticated;

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
       and id not in (select s.id from store_history s where s.shop_id = OLD.id order by s.id desc limit 4);
  end if;
  return NEW;
end;
$$;

revoke all on function public._store_history() from public;
revoke all on function public._store_history() from anon;
revoke all on function public._store_history() from authenticated;

drop trigger if exists _store_history on public.store;
create trigger _store_history
  before update on public.store
  for each row
  when (OLD.data is distinct from NEW.data)
  execute function public._store_history();
