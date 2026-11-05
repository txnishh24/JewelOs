-- ═══════════════════════════════════════════════════════════════════
-- 012_karigar_ledger_flag.sql
-- NOT APPLIED. Written 6 Nov 2026. Apply after 010 and 011, to jewelos-test first, then production.
-- Deploy the store-proxy change AFTER this migration (kg_status / kg_set_ledger call these functions).
--
-- Two things, both from the Karigar branch security review:
--
-- 1. Whether a shop's gold goes through the ledger is held by the SERVER, not in the shop data. The shop
--    data can be rewritten by any staff login (review finding 4), so a flag stored there could be
--    switched off (gold then bypasses the ledger) or on by someone who should not. Only the owner can
--    change it, through store-proxy action kg_set_ledger; every logged-in owner or manager can read it.
--
-- 2. Labour is owner only in the database as well (Tanish, 6 Nov, review point A3; store-proxy and the
--    app already refuse it): a manager cannot post LABOUR_ACCRUE / LABOUR_PAY, and cannot reverse one.
--    Done with a trigger on kg_journal so the 011 posting function does not have to be copied. The
--    trigger raises SQLSTATE KG001, which 011 turns into a plain "not ok" answer.
-- Idempotent: safe to run twice.
-- ═══════════════════════════════════════════════════════════════════

create table if not exists public.kg_ledger_flag (
  shop_id    text primary key,
  ledger_on  boolean     not null default false,
  changed_by text,
  changed_at timestamptz not null default now()
);
alter table public.kg_ledger_flag enable row level security;
revoke all on public.kg_ledger_flag from anon;
revoke all on public.kg_ledger_flag from authenticated;

create or replace function public.kg_ledger_status(p_shop_id text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select ledger_on from kg_ledger_flag where shop_id = p_shop_id), false)
$$;

create or replace function public.kg_set_ledger(p_shop_id text, p_on boolean, p_by text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  insert into kg_ledger_flag (shop_id, ledger_on, changed_by, changed_at)
  values (p_shop_id, coalesce(p_on, false), p_by, now())
  on conflict (shop_id) do update
    set ledger_on = excluded.ledger_on, changed_by = excluded.changed_by, changed_at = excluded.changed_at;
  return coalesce(p_on, false);
end $$;

revoke all on function public.kg_ledger_status(text) from public;
revoke all on function public.kg_ledger_status(text) from anon;
revoke all on function public.kg_ledger_status(text) from authenticated;
grant execute on function public.kg_ledger_status(text) to service_role;
revoke all on function public.kg_set_ledger(text, boolean, text) from public;
revoke all on function public.kg_set_ledger(text, boolean, text) from anon;
revoke all on function public.kg_set_ledger(text, boolean, text) from authenticated;
grant execute on function public.kg_set_ledger(text, boolean, text) to service_role;

-- labour is owner only, and so is undoing it
create or replace function public.kg_labour_owner_only() returns trigger
language plpgsql as $$
declare v_target text;
begin
  if new.by_role <> 'owner' then
    if new.type in ('LABOUR_ACCRUE', 'LABOUR_PAY') then
      raise exception 'labour entries are owner only' using errcode = 'KG001';
    end if;
    if new.type = 'REVERSAL' and new.reverses_id is not null then
      select type into v_target from kg_journal where id = new.reverses_id and shop_id = new.shop_id;
      if v_target in ('LABOUR_ACCRUE', 'LABOUR_PAY') then
        raise exception 'reversing a labour entry is owner only' using errcode = 'KG001';
      end if;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists kg_journal_labour_owner_only on public.kg_journal;
create trigger kg_journal_labour_owner_only before insert on public.kg_journal
  for each row execute function public.kg_labour_owner_only();
