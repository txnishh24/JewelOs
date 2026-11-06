-- ═══════════════════════════════════════════════════════════════════
-- 011_karigar_ledger_hardening.sql  —  Karigar 2.0 Task 2.5. APPLIED to production uluzuwomwqsqxtejgzmf on 4 Nov 2026.
-- Replaces public.kg_post_journal from 010 (same signature, same grants). Apply AFTER 010.
-- Plan: docs/superpowers/plans/2026-11-03-karigar-2-remaining-phases.md, Task 2.5.
-- Tested by tests/sql-kg-ledger.test.mjs section 14 (npm run test:sql).
--
-- What changes, and why (each item is a finding from the 4 Nov reviews):
--   F1  The journal TYPE now decides which accounts and directions its lines may use (template
--       below). Before, store-proxy checked the type label only, so a manager could post an allowed
--       type such as RECEIPT with ADJ/OPENING lines and create custody out of nothing.
--       ADJUST / OPENING, and any ADJ or OPENING line (also inside a REVERSAL), are owner only here.
--   F2  Only the ledger's own refusals (SQLSTATE KG001) become a plain "not ok" answer. Any other
--       database error (deadlock, serialization failure, timeout) now propagates, so store-proxy
--       answers 500 and the client keeps the journal and retries, instead of parking it as refused
--       and showing a raw database message. Malformed lines are checked here, so they are a clear
--       refusal and cannot become a retry-forever 500.
--   F3  A LOSS must carry an approver (interim rule until the pending-approval flow, plan Task 8).
--   D8  A REVERSAL must mirror the labour lines as well as the metal lines. Both comparisons are
--       now exact multiset comparisons (EXCEPT ALL), so duplicate lines cannot hide a stray line.
--   D9  The same op_id with different content is refused ("different content"), not reported as a
--       duplicate. The server stores a fingerprint of what it received in meta->>'h'.
--       Rows posted before 011 have no fingerprint and keep the old behaviour.
--   D10 A manager's business_date must be today (India time) or up to 7 days back. The owner is
--       not limited.
--   D3  Type OPENING may now also open a karigar's custody: KCUST (or WIP) against OPENING.
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
  v_existing bigint; v_oldhash text; v_hash text; v_id bigint; v_sum bigint; v_vault boolean;
  v_line jsonb; v_n integer := 0; r record; v_target record;
  v_allowed text[]; v_key text; v_today date; v_labour jsonb;
begin
  perform pg_advisory_xact_lock(hashtext('kg:' || p_shop_id));

  v_labour := case when p_labour is null or jsonb_typeof(p_labour) = 'null' then '[]'::jsonb else p_labour end;

  -- D9: fingerprint of what this call asks for (not note/meta, which may legitimately differ)
  -- built as a JSON array so where one field ends is never ambiguous (a plain '|' join is)
  v_hash := md5(jsonb_build_array(coalesce(p_type,''), p_job_id, p_voucher_id, p_reverses_id,
                                  p_business_date, p_lines, v_labour)::text);

  select id, meta->>'h' into v_existing, v_oldhash from kg_journal where shop_id = p_shop_id and op_id = p_op_id;
  if v_existing is not null then
    -- a migr: id only ever belongs to an owner OPENING; an older row under it (posted before the reservation) is not one
    if p_op_id like 'migr:%' and (p_type <> 'OPENING' or p_by_role <> 'owner'
        or (select type from kg_journal where id = v_existing) <> 'OPENING') then
      return query select false, false, null::bigint, 'op_id prefix migr: is reserved for the owner''s opening balances'; return;
    end if;
    if v_oldhash is not null and v_oldhash <> v_hash then
      return query select false, false, null::bigint, 'op_id already used with different content'; return;
    end if;
    return query select true, true, v_existing, null::text; return;
  end if;

  -- a missing type or role would make every later "<> 'owner'" test unknown and skip the check
  if p_type is null or p_by_role is null then
    return query select false, false, null::bigint, 'journal type and role are required'; return;
  end if;

  -- the migr: op_id prefix is reserved for the owner's opening balances, so nobody can take a migration id first
  -- and make the owner's real opening journal a conflict
  if p_op_id like 'migr:%' and (p_type <> 'OPENING' or p_by_role <> 'owner') then
    return query select false, false, null::bigint, 'op_id prefix migr: is reserved for the owner''s opening balances'; return;
  end if;

  -- shape checks (F2): everything below may cast, so refuse bad input here, in plain words
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    return query select false, false, null::bigint, 'lines required'; return;
  end if;
  if jsonb_typeof(v_labour) <> 'array' then
    return query select false, false, null::bigint, 'labour must be a list'; return;
  end if;
  if p_business_date is null then
    return query select false, false, null::bigint, 'business date required'; return;
  end if;
  for v_line in select * from jsonb_array_elements(p_lines) loop
    if jsonb_typeof(v_line) <> 'object'
       or coalesce(jsonb_typeof(v_line->'owner_ref'), 'string') not in ('string', 'null')
       or coalesce(jsonb_typeof(v_line->'account'), '') <> 'string'
       or coalesce(jsonb_typeof(v_line->'fine_mg'), '') <> 'number'
       or (v_line->>'fine_mg') !~ '^-?[0-9]{1,15}$' or (v_line->>'fine_mg') ~ '^-?0+$'
       or coalesce(v_line->>'gross_mg', '') !~ '^(-?[0-9]{1,15})?$'
       or coalesce(v_line->>'permille', '1') !~ '^(1000|[1-9][0-9]{0,2})$' then
      return query select false, false, null::bigint, 'malformed line'; return;
    end if;
  end loop;
  for v_line in select * from jsonb_array_elements(v_labour) loop
    if jsonb_typeof(v_line) <> 'object'
       or coalesce(jsonb_typeof(v_line->'karigar_id'), '') <> 'string' or (v_line->>'karigar_id') = ''
       or coalesce(jsonb_typeof(v_line->'amount_paise'), '') <> 'number'
       or (v_line->>'amount_paise') !~ '^-?[0-9]{1,15}$' or (v_line->>'amount_paise') ~ '^-?0+$' then
      return query select false, false, null::bigint, 'malformed labour line'; return;
    end if;
  end loop;

  select coalesce(sum((l->>'fine_mg')::bigint), 0) into v_sum from jsonb_array_elements(p_lines) l;
  if v_sum <> 0 then
    return query select false, false, null::bigint, 'journal does not balance (sum fine_mg = ' || v_sum || ')'; return;
  end if;

  -- F1: which accounts, in which direction, each type may use. '+' / '-' = sign of fine_mg, '*' = either.
  -- Metal-free types (labour) may carry no metal lines at all. REVERSAL is checked by the mirror rule below.
  if p_type <> 'REVERSAL' then
    v_allowed := case p_type
      when 'ISSUE'              then array['VAULT:-','KCUST:+']
      when 'RETURN'             then array['KCUST:-','VAULT:+']
      when 'RECEIPT'            then array['KCUST:-','FG:+']
      when 'SCRAP'              then array['KCUST:-','SCRAP:+']
      when 'LOSS'               then array['KCUST:-','LOSS:+']
      when 'TRANSFER_OUT'       then array['KCUST:-','TRANSIT:+']
      when 'TRANSFER_IN'        then array['TRANSIT:-','KCUST:+']
      when 'ENTITLEMENT_ACCRUE' then array['ENT:+','EARNED:-']
      when 'ENTITLEMENT_SETTLE' then array['VAULT:-','KCUST:-','PAYOUT:+','ENT:-','EARNED:+']
      when 'OPENING'            then array['VAULT:+','KCUST:+','WIP:+','OPENING:-']
      when 'ADJUST'             then array['KCUST:*','ADJ:*']
      when 'LABOUR_ACCRUE'      then array[]::text[]
      when 'LABOUR_PAY'         then array[]::text[]
      else null end;
    if v_allowed is null then
      return query select false, false, null::bigint, 'unknown journal type'; return;
    end if;
    for v_line in select * from jsonb_array_elements(p_lines) loop
      v_key := (v_line->>'account') || ':' || case when (v_line->>'fine_mg')::bigint > 0 then '+' else '-' end;
      if not (v_key = any(v_allowed) or (v_line->>'account') || ':*' = any(v_allowed)) then
        return query select false, false, null::bigint,
          'account ' || (v_line->>'account') || ' is not allowed in a ' || p_type || ' journal in that direction'; return;
      end if;
      -- owner references (D2): the shop vault and the OPENING account have none; karigar accounts must name a karigar.
      -- Without this, metal can be parked under a made-up vault name that no screen reads.
      if ((v_line->>'account') in ('VAULT', 'OPENING') and coalesce(v_line->>'owner_ref', '') <> '')
         or ((v_line->>'account') in ('KCUST', 'ENT', 'EARNED', 'PAYOUT', 'SCRAP', 'LOSS', 'FG')
             and coalesce(v_line->>'owner_ref', '') !~ '^[A-Za-z0-9_-]{1,64}$') then
        -- a karigar reference is a plain id (existing ids are "kar" + digits or a UUID): no spaces, no
        -- look-alike or invisible characters. The database has no karigar list, so a well-formed made-up id still passes.
        return query select false, false, null::bigint,
          'owner reference does not fit account ' || (v_line->>'account'); return;
      end if;
    end loop;

    -- the accounts being allowed is not enough: the lines must have the exact shape of the event
    if jsonb_array_length(p_lines) = 0 and p_type not in ('LABOUR_ACCRUE', 'LABOUR_PAY') then
      return query select false, false, null::bigint, 'a journal needs at least one line'; return;
    end if;
    -- a single metal event is exactly one pair of lines. A looser rule ("a matching pair exists") lets extra
    -- lines in the same journal move another karigar's custody into a third karigar's bucket.
    if p_type in ('ISSUE', 'RETURN', 'RECEIPT', 'SCRAP', 'LOSS', 'TRANSFER_OUT', 'TRANSFER_IN', 'OPENING', 'ADJUST')
       and jsonb_array_length(p_lines) <> 2 then
      return query select false, false, null::bigint, 'a ' || p_type || ' journal has exactly two lines'; return;
    end if;
    -- finished goods belong to a job: a receipt names its job and its FG line carries exactly that id
    -- (otherwise metal can sit in an FG bucket no job screen reads)
    if p_type = 'RECEIPT' and (p_job_id is null or exists (
         select 1 from jsonb_array_elements(p_lines) l
         where l->>'account' = 'FG' and l->>'owner_ref' is distinct from p_job_id)) then
      return query select false, false, null::bigint, 'a receipt must carry a job id, and its FG line must name that same job'; return;
    end if;
    -- a transit line belongs to its own voucher; scrap and loss come out of the same karigar's custody
    if exists (select 1 from jsonb_array_elements(p_lines) l where l->>'account' = 'TRANSIT'
               and (p_voucher_id is null or coalesce(l->>'owner_ref', '') = '' or l->>'owner_ref' <> p_voucher_id)) then
      return query select false, false, null::bigint, 'a transit line must carry the id of its own voucher'; return;
    end if;
    if p_type in ('SCRAP', 'LOSS') and not exists (
         select 1 from jsonb_array_elements(p_lines) a, jsonb_array_elements(p_lines) b
         where a->>'account' = 'KCUST' and b->>'account' = p_type
           and coalesce(a->>'owner_ref', '') = coalesce(b->>'owner_ref', '')) then
      return query select false, false, null::bigint, 'a scrap or loss must name the same karigar as the custody it comes from'; return;
    end if;
    -- accrue: ENT +e and EARNED -e, same karigar, nothing else
    if p_type = 'ENTITLEMENT_ACCRUE' and not (jsonb_array_length(p_lines) = 2 and exists (
         select 1 from jsonb_array_elements(p_lines) a, jsonb_array_elements(p_lines) b
         where a->>'account' = 'ENT' and b->>'account' = 'EARNED'
           and coalesce(a->>'owner_ref','') = coalesce(b->>'owner_ref','')
           and (a->>'fine_mg')::bigint = -(b->>'fine_mg')::bigint)) then
      return query select false, false, null::bigint, 'an entitlement accrual must be exactly ENT +e and EARNED -e for one karigar'; return;
    end if;
    -- settle: source -e (that karigar's KCUST, or the VAULT), PAYOUT +e, ENT -e, EARNED +e, one karigar, nothing else
    if p_type = 'ENTITLEMENT_SETTLE' and not (jsonb_array_length(p_lines) = 4 and exists (
         select 1 from jsonb_array_elements(p_lines) pay
         where pay->>'account' = 'PAYOUT' and (pay->>'fine_mg')::bigint > 0
           and (select count(*) from jsonb_array_elements(p_lines) x where x->>'account' = 'PAYOUT') = 1
           and (select count(*) from jsonb_array_elements(p_lines) x
                where x->>'account' = 'ENT' and coalesce(x->>'owner_ref','') = coalesce(pay->>'owner_ref','')
                  and (x->>'fine_mg')::bigint = -(pay->>'fine_mg')::bigint) = 1
           and (select count(*) from jsonb_array_elements(p_lines) x
                where x->>'account' = 'EARNED' and coalesce(x->>'owner_ref','') = coalesce(pay->>'owner_ref','')
                  and (x->>'fine_mg')::bigint = (pay->>'fine_mg')::bigint) = 1
           and (select count(*) from jsonb_array_elements(p_lines) x
                where ((x->>'account' = 'KCUST' and coalesce(x->>'owner_ref','') = coalesce(pay->>'owner_ref',''))
                       or (x->>'account' = 'VAULT' and coalesce(x->>'owner_ref','') = ''))
                  and (x->>'fine_mg')::bigint = -(pay->>'fine_mg')::bigint) = 1)) then
      return query select false, false, null::bigint, 'an entitlement settlement must be exactly: source -e, PAYOUT +e, ENT -e, EARNED +e, for one karigar'; return;
    end if;
    -- labour lines must fit the type and direction: accrue adds to what is owed, pay reduces it, metal journals carry none
    if (p_type = 'LABOUR_ACCRUE' and (jsonb_array_length(v_labour) = 0
          or exists (select 1 from jsonb_array_elements(v_labour) b where (b->>'amount_paise')::bigint < 0)))
       or (p_type = 'LABOUR_PAY' and (jsonb_array_length(v_labour) = 0
          or exists (select 1 from jsonb_array_elements(v_labour) b where (b->>'amount_paise')::bigint > 0)))
       or (p_type not in ('LABOUR_ACCRUE', 'LABOUR_PAY') and jsonb_array_length(v_labour) > 0) then
      return query select false, false, null::bigint, 'labour lines do not fit a ' || p_type || ' journal'; return;
    end if;
  end if;

  -- only a reversal may name a journal (store-proxy checks this too; the database must not rely on it)
  if p_type <> 'REVERSAL' and p_reverses_id is not null then
    return query select false, false, null::bigint, 'only a reversal may name a journal to reverse'; return;
  end if;

  -- owner only: ADJUST / OPENING, and any line on the ADJ / OPENING accounts (also in a reversal)
  -- (Tanish, 4 Nov: managers KEEP accrue and settle, so ENTITLEMENT_ACCRUE is not owner only)
  if p_by_role <> 'owner' and (p_type in ('ADJUST', 'OPENING')
     or exists (select 1 from jsonb_array_elements(p_lines) l where l->>'account' in ('ADJ', 'OPENING'))) then
    return query select false, false, null::bigint, 'owner only'; return;
  end if;

  -- F3 (interim): no loss without an approver
  if p_type = 'LOSS' and p_approved_by is null then
    return query select false, false, null::bigint, 'a loss needs owner approval'; return;
  end if;

  -- D10: managers post for today (India time) or up to 7 days back
  v_today := (now() at time zone 'Asia/Kolkata')::date;
  if p_by_role <> 'owner' and (p_business_date > v_today or p_business_date < v_today - 7) then
    return query select false, false, null::bigint, 'business date out of range: managers may post from 7 days ago up to today'; return;
  end if;

  if p_type = 'REVERSAL' then
    select * into v_target from kg_journal where id = p_reverses_id and shop_id = p_shop_id;
    if not found then return query select false, false, null::bigint, 'reversal target not found'; return; end if;
    if v_target.type = 'REVERSAL' then return query select false, false, null::bigint, 'cannot reverse a reversal'; return; end if;
    -- a reversal needs the authority of the original (the line check above also catches old rows)
    -- (anything the owner approved, such as an approved loss, can only be undone by the owner)
    if p_by_role <> 'owner' and (v_target.type in ('ADJUST', 'OPENING') or v_target.approved_by is not null) then
      return query select false, false, null::bigint, 'owner only'; return;
    end if;
    -- metal lines must mirror the target exactly: same accounts and owners, fine_mg negated, same count
    if exists (select account, owner_ref, -fine_mg from kg_journal_line where journal_id = p_reverses_id
               except all
               select l->>'account', coalesce(l->>'owner_ref',''), (l->>'fine_mg')::bigint from jsonb_array_elements(p_lines) l)
       or exists (select l->>'account', coalesce(l->>'owner_ref',''), (l->>'fine_mg')::bigint from jsonb_array_elements(p_lines) l
               except all
               select account, owner_ref, -fine_mg from kg_journal_line where journal_id = p_reverses_id) then
      return query select false, false, null::bigint, 'reversal lines do not mirror the original'; return;
    end if;
    -- D8: labour lines must mirror too
    if exists (select karigar_id, -amount_paise from kg_labour_line where journal_id = p_reverses_id
               except all
               select b->>'karigar_id', (b->>'amount_paise')::bigint from jsonb_array_elements(v_labour) b)
       or exists (select b->>'karigar_id', (b->>'amount_paise')::bigint from jsonb_array_elements(v_labour) b
               except all
               select karigar_id, -amount_paise from kg_labour_line where journal_id = p_reverses_id) then
      return query select false, false, null::bigint, 'reversal labour lines do not mirror the original'; return;
    end if;
  end if;

  begin
    insert into kg_journal (shop_id, op_id, type, job_id, voucher_id, reverses_id, business_date,
                            note, by_user, by_role, approved_by, meta)
    values (p_shop_id, p_op_id, p_type, p_job_id, p_voucher_id, p_reverses_id, p_business_date,
            coalesce(p_note,''), p_by_user, p_by_role, p_approved_by,
            (case when jsonb_typeof(p_meta) = 'object' then p_meta else '{}'::jsonb end) || jsonb_build_object('h', v_hash))
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
  for v_line in select * from jsonb_array_elements(v_labour) loop
    v_n := v_n + 1;
    insert into kg_labour_line (journal_id, line_no, karigar_id, amount_paise, mode)
    values (v_id, v_n, v_line->>'karigar_id', (v_line->>'amount_paise')::bigint, v_line->>'mode');
  end loop;

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
    if r.bal < 0 and r.account in ('KCUST','WIP','FG','SCRAP','TRANSIT','ENT')
       or (r.bal < 0 and r.account = 'VAULT' and v_vault) then
      raise exception 'account % % would go negative (%)', r.account, r.owner_ref, r.bal
        using errcode = 'KG001';
    end if;
  end loop;

  return query select true, false, v_id, null::text;
exception when sqlstate 'KG001' then
  -- the ledger's own refusal: the whole journal rolls back and the reason is returned.
  -- Any other error is NOT caught here; it propagates so the caller can retry.
  return query select false, false, null::bigint, sqlerrm;
end $$;

revoke all on function public.kg_post_journal(text,text,text,text,text,bigint,date,text,text,text,text,jsonb,jsonb,jsonb) from public;
revoke all on function public.kg_post_journal(text,text,text,text,text,bigint,date,text,text,text,text,jsonb,jsonb,jsonb) from anon;
revoke all on function public.kg_post_journal(text,text,text,text,text,bigint,date,text,text,text,text,jsonb,jsonb,jsonb) from authenticated;
grant execute on function public.kg_post_journal(text,text,text,text,text,bigint,date,text,text,text,text,jsonb,jsonb,jsonb) to service_role;
