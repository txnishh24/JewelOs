-- ═══════════════════════════════════════════════════════════════════
-- 010_karigar_ledger.sql  —  Karigar 2.0 immutable ledger. applied to the TEST project jewelos-test (31 Oct 2026, older form) and to PRODUCTION uluzuwomwqsqxtejgzmf on 4 Nov 2026 (this version, comments stripped). store-proxy NOT yet deployed.
-- Karigar 2.0 immutable metal/labour journal. Design: JewelOS-Karigar-2.0-Phase2-Design.md
--
-- Pattern copied from 001_lockdown_rls.sql + 002_atomic_transactions.sql:
--   * RLS on, no policies, anon/authenticated revoked  -> default deny
--   * only service_role (the store-proxy Edge Function) can execute the RPCs
--   * the shop id is NEVER taken from the browser: store-proxy derives it from
--     the session token and passes it as p_shop_id
-- Additive and idempotent. Touches no existing table. Tested on real Postgres (PGlite) by
-- tests/sql-kg-ledger.test.mjs. Apply to a COPY / test project first and run that test
-- there; only then production. Deploy the store-proxy change AFTER this migration.
-- ═══════════════════════════════════════════════════════════════════

-- ── per-shop settings ─────────────────────────────────────────────────
create table if not exists public.kg_shop_setting (
  shop_id       text primary key,
  vault_tracked boolean not null default false,   -- Q1: does the shop track its own bullion?
  created_at    timestamptz not null default now()
);

-- ── journal header: one row per posted event, never updated ───────────
create table if not exists public.kg_journal (
  id            bigint generated always as identity primary key,
  shop_id       text        not null,
  op_id         text        not null,             -- client idempotency key
  type          text        not null check (type in (
                  'ISSUE','RETURN','RECEIPT','SCRAP','LOSS','TRANSFER_OUT','TRANSFER_IN',
                  'ENTITLEMENT_ACCRUE','ENTITLEMENT_SETTLE','LABOUR_ACCRUE','LABOUR_PAY',
                  'ADJUST','OPENING','REVERSAL')),
  job_id        text,
  voucher_id    text,
  reverses_id   bigint references public.kg_journal(id),
  business_date date        not null,
  note          text        not null default '',
  by_user       text        not null,
  by_role       text        not null,
  approved_by   text,                              -- owner for LOSS over standard / ADJUST
  meta          jsonb       not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  unique (shop_id, op_id)                          -- duplicate submission = same row
);
-- a journal can be reversed at most once
create unique index if not exists kg_journal_one_reversal
  on public.kg_journal (reverses_id) where reverses_id is not null;
create index if not exists kg_journal_shop_job on public.kg_journal (shop_id, job_id);
create index if not exists kg_journal_shop_date on public.kg_journal (shop_id, business_date);

-- ── journal lines: signed fine milligrams per account ─────────────────
-- custody (must stay >= 0): VAULT*, KCUST, WIP, FG, SCRAP, TRANSIT      (*only if vault_tracked)
-- accumulators (may only grow): LOSS (approved loss), PAYOUT (gold actually paid out as earnings)
-- claims / clearing (sign free): ENT (gold owed to karigar), EARNED (clearing for ENT), OPENING, ADJ
-- Entitlement postings, all sum to zero:
--   accrue            : ENT +e, EARNED -e
--   settle by keeping : KCUST -e, PAYOUT +e, ENT -e, EARNED +e
--   settle from vault : VAULT -e, PAYOUT +e, ENT -e, EARNED +e
--   opening vault     : VAULT +x, OPENING -x          owner adjustment: KCUST +-a, ADJ -+a
-- owner_ref: karigar id / job id / voucher id the account belongs to ('' if none)
-- labour (paise) lives in its own lines table so metal and money can never be summed together
create table if not exists public.kg_journal_line (
  journal_id bigint  not null references public.kg_journal(id),
  line_no    integer not null,
  account    text    not null check (account in ('VAULT','KCUST','WIP','FG','SCRAP','LOSS','TRANSIT','ENT','EARNED','PAYOUT','OPENING','ADJ')),
  owner_ref  text    not null default '',
  fine_mg    bigint  not null check (fine_mg <> 0),
  gross_mg   bigint,                               -- physical weight, informational
  permille   integer check (permille between 1 and 1000),
  primary key (journal_id, line_no)
);
create index if not exists kg_line_account on public.kg_journal_line (account, owner_ref);

create table if not exists public.kg_labour_line (
  journal_id   bigint  not null references public.kg_journal(id),
  line_no      integer not null,
  karigar_id   text    not null,
  amount_paise bigint  not null check (amount_paise <> 0),   -- + payable, - paid/advance
  mode         text,
  primary key (journal_id, line_no)
);
create index if not exists kg_labour_karigar on public.kg_labour_line (karigar_id);

-- ── immutability: posted rows can never change or disappear ───────────
create or replace function public.kg_block_mutation() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'kg ledger rows are immutable; post a REVERSAL journal instead';
end $$;

do $$
declare t text;
begin
  foreach t in array array['kg_journal','kg_journal_line','kg_labour_line'] loop
    execute format('drop trigger if exists %I_immutable on public.%I', t, t);
    execute format('create trigger %I_immutable before update or delete on public.%I
                    for each row execute function public.kg_block_mutation()', t, t);
    execute format('drop trigger if exists %I_nottruncate on public.%I', t, t);
    execute format('create trigger %I_nottruncate before truncate on public.%I
                    for each statement execute function public.kg_block_mutation()', t, t);
  end loop;
end $$;

-- ── lock the tables down (default deny) ───────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['kg_shop_setting','kg_journal','kg_journal_line','kg_labour_line'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke all on public.%I from authenticated', t);
  end loop;
end $$;

-- ═══════════════════════════════════════════════════════════════════
-- kg_post_journal  —  the ONLY write path
--   p_lines  : [{account, owner_ref, fine_mg, gross_mg?, permille?}, ...]
--   p_labour : [{karigar_id, amount_paise, mode?}, ...]
-- Guarantees, all inside one transaction:
--   1. idempotent: same (shop, op_id) returns the existing journal, writes nothing
--   2. metal conserves: sum(fine_mg) over the lines = 0  (nothing created/destroyed)
--      there is no "free metal" journal type: OPENING, ADJUST and ENTITLEMENT_* carry
--      their own balancing lines (OPENING / ADJ / EARNED / PAYOUT), so they sum to 0 too.
--   3. custody accounts never go negative (KCUST, WIP, FG, SCRAP, TRANSIT, and
--      VAULT when the shop tracks it)
--   4. REVERSAL must be the exact negation of an unreversed journal of the same shop
--   5. postings for one shop are serialised (advisory lock) so check 3 is race-free
-- Returns (ok, duplicate, journal_id, error)
-- ═══════════════════════════════════════════════════════════════════
create or replace function public.kg_post_journal(
  p_shop_id text, p_op_id text, p_type text, p_job_id text, p_voucher_id text,
  p_reverses_id bigint, p_business_date date, p_note text,
  p_by_user text, p_by_role text, p_approved_by text, p_meta jsonb,
  p_lines jsonb, p_labour jsonb
) returns table(ok boolean, duplicate boolean, journal_id bigint, error text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_existing bigint; v_id bigint; v_sum bigint; v_vault boolean;
  v_line jsonb; v_n integer := 0; r record; v_target record; v_mirror bigint;
  v_fp text; v_stored text; v_rules jsonb; v_today date; v_v bigint;
begin
  perform pg_advisory_xact_lock(hashtext('kg:' || p_shop_id));

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    return query select false, false, null::bigint, 'lines required'; return;
  end if;
  if p_labour is not null and jsonb_typeof(p_labour) <> 'array' then
    return query select false, false, null::bigint, 'labour must be a list'; return;
  end if;

  -- ids are joined into comparison strings below, so they may not contain separators
  if exists (select 1 from jsonb_array_elements(p_lines) l
             where coalesce(l->>'owner_ref','') !~ '^[A-Za-z0-9:_.-]{0,64}$'
                or coalesce(l->>'account','') !~ '^[A-Z]{2,12}$')
     or exists (select 1 from jsonb_array_elements(coalesce(p_labour,'[]'::jsonb)) b
                where coalesce(b->>'karigar_id','') !~ '^[A-Za-z0-9:_.-]{1,64}$') then
    return query select false, false, null::bigint, 'ids may only contain letters, digits and : _ . -'; return;
  end if;

  -- content fingerprint: type, date, lines and labour, independent of line order (D9)
  v_fp := md5(jsonb_build_array(
      p_type, p_business_date, p_job_id, p_voucher_id, p_reverses_id,
      coalesce((select jsonb_agg(x order by x) from (
         select jsonb_build_array(l->>'account', coalesce(l->>'owner_ref',''), l->>'fine_mg',
                                  l->>'gross_mg', l->>'permille') as x
         from jsonb_array_elements(p_lines) l) q), '[]'::jsonb),
      coalesce((select jsonb_agg(x order by x) from (
         select jsonb_build_array(b->>'karigar_id', b->>'amount_paise', b->>'mode') as x
         from jsonb_array_elements(coalesce(p_labour, '[]'::jsonb)) b) q2), '[]'::jsonb))::text);

  select id, meta->>'fp' into v_existing, v_stored from kg_journal where shop_id = p_shop_id and op_id = p_op_id;
  if v_existing is not null then
    -- same op_id with different content is a client bug, never a harmless resend. Journals
    -- posted before the fingerprint existed (no stored fp) keep the old duplicate answer.
    if v_stored is not null and v_stored <> v_fp then
      return query select false, false, null::bigint, 'op_id already used with different content'; return;
    end if;
    return query select true, true, v_existing, null::text; return;
  end if;

  select coalesce(sum((l->>'fine_mg')::bigint), 0) into v_sum from jsonb_array_elements(p_lines) l;
  if v_sum <> 0 then
    return query select false, false, null::bigint, 'journal does not balance (sum fine_mg = ' || v_sum || ')'; return;
  end if;

  -- ledger rules that do not trust the label alone. store-proxy checks shape and the owner-only
  -- TYPES only; THIS is the real enforcement of accounts, signs, approval and dates.
  if p_type in ('ADJUST','OPENING') and p_by_role <> 'owner' then
    return query select false, false, null::bigint, 'owner only'; return;
  end if;
  if p_by_role <> 'owner' and exists (select 1 from jsonb_array_elements(p_lines) l
                                      where l->>'account' in ('OPENING','ADJ')) then
    return query select false, false, null::bigint, 'owner only'; return;
  end if;
  -- per type: which accounts may appear and with which sign ('+' gain, '-' give, '*' either).
  -- A line outside this shape is refused, so a sign-flipped line cannot mint metal.
  v_rules := case p_type
    when 'ISSUE' then '{"VAULT":"-","KCUST":"+"}'
    when 'RETURN' then '{"KCUST":"-","VAULT":"+"}'
    when 'RECEIPT' then '{"KCUST":"-","FG":"+"}'
    when 'SCRAP' then '{"KCUST":"-","SCRAP":"+"}'
    when 'LOSS' then '{"KCUST":"-","LOSS":"+"}'
    when 'TRANSFER_OUT' then '{"KCUST":"-","TRANSIT":"+"}'
    when 'TRANSFER_IN' then '{"TRANSIT":"-","KCUST":"+"}'
    when 'ENTITLEMENT_ACCRUE' then '{"ENT":"+","EARNED":"-"}'
    when 'ENTITLEMENT_SETTLE' then '{"KCUST":"-","VAULT":"-","PAYOUT":"+","ENT":"-","EARNED":"+"}'
    when 'LABOUR_ACCRUE' then '{}'
    when 'LABOUR_PAY' then '{}'
    when 'ADJUST' then '{"KCUST":"*","WIP":"*","ADJ":"*"}'
    when 'OPENING' then '{"VAULT":"+","KCUST":"+","WIP":"+","OPENING":"-"}'
    else null                     -- REVERSAL: the exact one-to-one mirror rule below is the limit
  end::jsonb;
  if v_rules is not null and exists (
       select 1 from jsonb_array_elements(p_lines) l
       where coalesce(v_rules->>(l->>'account'), '') = ''
          or (v_rules->>(l->>'account') = '+' and (l->>'fine_mg')::bigint <= 0)
          or (v_rules->>(l->>'account') = '-' and (l->>'fine_mg')::bigint >= 0)) then
    return query select false, false, null::bigint, 'line not allowed for ' || p_type; return;
  end if;
  if p_type = 'ENTITLEMENT_ACCRUE' and exists (
       select 1 from jsonb_array_elements(p_lines) l
       group by coalesce(l->>'owner_ref','')
       having sum((l->>'fine_mg')::bigint) <> 0) then
    return query select false, false, null::bigint, 'accrual lines do not pair up per karigar'; return;
  end if;
  if p_type = 'ENTITLEMENT_SETTLE' then
    -- one karigar: PAYOUT +e, ENT -e, EARNED +e, and the metal leaves that karigar's custody
    -- (KCUST) or the vault (VAULT), never both
    select coalesce(sum((l->>'fine_mg')::bigint) filter (where l->>'account' = 'VAULT'), 0) into v_v
      from jsonb_array_elements(p_lines) l;
    if exists (
         select 1 from (
           select coalesce(l->>'owner_ref','') o,
                  coalesce(sum((l->>'fine_mg')::bigint) filter (where l->>'account' = 'PAYOUT'), 0) p,
                  coalesce(sum((l->>'fine_mg')::bigint) filter (where l->>'account' = 'ENT'), 0) e,
                  coalesce(sum((l->>'fine_mg')::bigint) filter (where l->>'account' = 'EARNED'), 0) er,
                  coalesce(sum((l->>'fine_mg')::bigint) filter (where l->>'account' = 'KCUST'), 0) kc
           from jsonb_array_elements(p_lines) l group by 1) g
         where g.e <> -g.p or g.er <> g.p or (v_v = 0 and g.kc <> -g.p) or (v_v <> 0 and g.kc <> 0)) then
      return query select false, false, null::bigint, 'settlement lines do not pair up'; return;
    end if;
  end if;
  if (p_type = 'LABOUR_ACCRUE' and exists (select 1 from jsonb_array_elements(coalesce(p_labour,'[]'::jsonb)) b
                                           where (b->>'amount_paise')::bigint <= 0))
     or (p_type = 'LABOUR_PAY' and exists (select 1 from jsonb_array_elements(coalesce(p_labour,'[]'::jsonb)) b
                                           where (b->>'amount_paise')::bigint >= 0)) then
    return query select false, false, null::bigint, 'labour amount has the wrong sign for ' || p_type; return;
  end if;
  if p_type not in ('LABOUR_ACCRUE','LABOUR_PAY','REVERSAL')
     and jsonb_array_length(coalesce(p_labour, '[]'::jsonb)) > 0 then
    return query select false, false, null::bigint, 'labour not allowed for ' || p_type; return;
  end if;
  if p_type = 'LOSS' and p_approved_by is null then
    return query select false, false, null::bigint, 'a loss needs owner approval'; return;
  end if;
  if p_by_role <> 'owner' then
    v_today := (now() at time zone 'Asia/Kolkata')::date;
    if p_business_date > v_today or p_business_date < v_today - 7 then
      return query select false, false, null::bigint, 'date outside the allowed window (today back to 7 days)'; return;
    end if;
  end if;

  if p_type = 'REVERSAL' then
    select * into v_target from kg_journal where id = p_reverses_id and shop_id = p_shop_id;
    if not found then return query select false, false, null::bigint, 'reversal target not found'; return; end if;
    if v_target.type = 'REVERSAL' then return query select false, false, null::bigint, 'cannot reverse a reversal'; return; end if;
    -- lines must mirror the target exactly, one-to-one: compare the two sorted lists (account,
    -- owner_ref, fine_mg), so duplicate lines cannot hide a different line (D8)
    if (select string_agg(x, ';' order by x) from (
          select account || ',' || owner_ref || ',' || (-fine_mg) as x
          from kg_journal_line where journal_id = p_reverses_id) t)
       is distinct from
       (select string_agg(x, ';' order by x) from (
          select (l->>'account') || ',' || coalesce(l->>'owner_ref','') || ',' || (l->>'fine_mg') as x
          from jsonb_array_elements(p_lines) l) u) then
      return query select false, false, null::bigint, 'reversal lines do not mirror the original'; return;
    end if;
    -- labour must mirror too, one-to-one, amounts negated
    if (select string_agg(x, ';' order by x) from (
          select karigar_id || ',' || (-amount_paise) as x
          from kg_labour_line where journal_id = p_reverses_id) t)
       is distinct from
       (select string_agg(x, ';' order by x) from (
          select (b->>'karigar_id') || ',' || (b->>'amount_paise') as x
          from jsonb_array_elements(coalesce(p_labour, '[]'::jsonb)) b) u) then
      return query select false, false, null::bigint, 'reversal labour does not mirror the original'; return;
    end if;
  end if;

  begin
    insert into kg_journal (shop_id, op_id, type, job_id, voucher_id, reverses_id, business_date,
                            note, by_user, by_role, approved_by, meta)
    values (p_shop_id, p_op_id, p_type, p_job_id, p_voucher_id, p_reverses_id, p_business_date,
            coalesce(p_note,''), p_by_user, p_by_role, p_approved_by,
            coalesce(p_meta,'{}'::jsonb) || jsonb_build_object('fp', v_fp))
    returning id into v_id;
  exception when unique_violation then
    -- lost a race on reversal uniqueness or on (shop, op_id)
    select id into v_existing from kg_journal where shop_id = p_shop_id and op_id = p_op_id;
    if v_existing is not null then return query select true, true, v_existing, null::text; return; end if;
    return query select false, false, null::bigint, 'already reversed'; return;
  end;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_n := v_n + 1;
    insert into kg_journal_line (journal_id, line_no, account, owner_ref, fine_mg, gross_mg, permille)
    values (v_id, v_n, v_line->>'account', coalesce(v_line->>'owner_ref',''),
            (v_line->>'fine_mg')::bigint, nullif(v_line->>'gross_mg','')::bigint, nullif(v_line->>'permille','')::integer);
  end loop;

  v_n := 0;
  if p_labour is not null and jsonb_typeof(p_labour) = 'array' then
    for v_line in select * from jsonb_array_elements(p_labour) loop
      v_n := v_n + 1;
      insert into kg_labour_line (journal_id, line_no, karigar_id, amount_paise, mode)
      values (v_id, v_n, v_line->>'karigar_id', (v_line->>'amount_paise')::bigint, v_line->>'mode');
    end loop;
  end if;

  select coalesce(vault_tracked, false) into v_vault from kg_shop_setting where shop_id = p_shop_id;
  v_vault := coalesce(v_vault, false);

  -- custody accounts touched by this journal must still be >= 0
  for r in
    select l.account, l.owner_ref,
           sum(l.fine_mg) as bal
    from kg_journal_line l join kg_journal j on j.id = l.journal_id
    where j.shop_id = p_shop_id
      and (l.account, l.owner_ref) in (select a->>'account', coalesce(a->>'owner_ref','')
                                       from jsonb_array_elements(p_lines) a)
    group by l.account, l.owner_ref
  loop
    if r.bal < 0 and r.account in ('KCUST','WIP','FG','SCRAP','TRANSIT','LOSS','PAYOUT','ENT')
       or (r.bal < 0 and r.account = 'VAULT' and v_vault) then
      raise exception 'account % % would go negative (%)', r.account, r.owner_ref, r.bal
        using errcode = 'KG001';
    end if;
  end loop;

  return query select true, false, v_id, null::text;
exception when sqlstate 'KG001' then
  -- only the ledger's own refusals (SQLSTATE KG001) become a normal answer; the block rolls the
  -- journal back. Any other fault (dropped connection, serialization failure, bad data) propagates
  -- so store-proxy answers 500 and the client keeps the journal in its outbox for retry,
  -- and no raw database text reaches the caller.
  return query select false, false, null::bigint, sqlerrm;
end $$;

revoke all on function public.kg_post_journal(text,text,text,text,text,bigint,date,text,text,text,text,jsonb,jsonb,jsonb) from public;
revoke all on function public.kg_post_journal(text,text,text,text,text,bigint,date,text,text,text,text,jsonb,jsonb,jsonb) from anon;
revoke all on function public.kg_post_journal(text,text,text,text,text,bigint,date,text,text,text,text,jsonb,jsonb,jsonb) from authenticated;
grant execute on function public.kg_post_journal(text,text,text,text,text,bigint,date,text,text,text,text,jsonb,jsonb,jsonb) to service_role;

-- ── read side: balances for one shop (derived, never stored) ──────────
create or replace function public.kg_balances(p_shop_id text)
returns table(account text, owner_ref text, fine_mg bigint)
language sql stable security definer set search_path = public as $$
  select l.account, l.owner_ref, sum(l.fine_mg)::bigint
  from kg_journal_line l join kg_journal j on j.id = l.journal_id
  where j.shop_id = p_shop_id
  group by l.account, l.owner_ref
  having sum(l.fine_mg) <> 0
$$;
revoke all on function public.kg_balances(text) from public;
revoke all on function public.kg_balances(text) from anon;
revoke all on function public.kg_balances(text) from authenticated;
grant execute on function public.kg_balances(text) to service_role;

-- ── read side: paged journal list and full export, as JSON for store-proxy ──
create or replace function public.kg_journal_list(p_shop_id text, p_after bigint default 0, p_limit integer default 200)
returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(row_j order by id), '[]'::jsonb) from (
    select j.id,
      jsonb_build_object(
        'id', j.id, 'op_id', j.op_id, 'type', j.type, 'job_id', j.job_id, 'voucher_id', j.voucher_id,
        'reverses_id', j.reverses_id, 'business_date', j.business_date, 'note', j.note,
        'by_user', j.by_user, 'by_role', j.by_role, 'approved_by', j.approved_by, 'meta', j.meta,
        'created_at', j.created_at,
        'lines', coalesce((select jsonb_agg(jsonb_build_object('account', l.account, 'owner_ref', l.owner_ref,
                   'fine_mg', l.fine_mg, 'gross_mg', l.gross_mg, 'permille', l.permille) order by l.line_no)
                 from kg_journal_line l where l.journal_id = j.id), '[]'::jsonb),
        'labour', coalesce((select jsonb_agg(jsonb_build_object('karigar_id', b.karigar_id,
                   'amount_paise', b.amount_paise, 'mode', b.mode) order by b.line_no)
                 from kg_labour_line b where b.journal_id = j.id), '[]'::jsonb)
      ) as row_j
    from kg_journal j
    where j.shop_id = p_shop_id and j.id > coalesce(p_after, 0)
    order by j.id
    limit least(greatest(coalesce(p_limit, 200), 1), 100000)
  ) t
$$;
revoke all on function public.kg_journal_list(text, bigint, integer) from public;
revoke all on function public.kg_journal_list(text, bigint, integer) from anon;
revoke all on function public.kg_journal_list(text, bigint, integer) from authenticated;
grant execute on function public.kg_journal_list(text, bigint, integer) to service_role;
