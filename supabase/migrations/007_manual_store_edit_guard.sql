-- ══════════════════════════════════════════════════════════════════════
-- JewelOS — manual-edit guard on `store` (9/10 Oct 2026)
--
-- Follow-up from the AI-Generated Code Security Auditor's review of the
-- save-conflict "rebase" fix (js/01-sync-core.js, docs/save-conflict-fix-
-- design.md): that fix makes a client resend its own current data on top
-- of a conflicting save, but only when it can prove the conflicting save
-- was its OWN earlier, already-resolved attempt -- never someone else's.
-- The proof is: the landed save's `_saveId` is one this tab's own
-- saveToCloud() minted, AND the stored `_v` is exactly one more than the
-- version this tab started from.
--
-- The hole the review found: a manual SQL edit to a shop's `store` row
-- (something a human operator does directly against the database, not
-- through store-proxy) can leave the row in a state a later client write
-- can't tell apart from its own prior landed save. The HANDOFF.md rule
-- asking Cowork to manually set `_saveId` AND bump `_v` on every manual
-- edit is real but unenforced -- a rule in a doc, not in code, and a
-- Backend Architect review of this migration's first draft (which only
-- checked `_saveId`) found it misses exactly the mistake the rule exists
-- to prevent: an operator who sets `_saveId` but forgets to bump `_v`.
-- This migration makes BOTH checks automatic and unskippable.
--
-- WHAT A REAL CLIENT WRITE ALWAYS LOOKS LIKE (store_cas_write, 002):
-- Under the `for update` row lock it already takes, store_cas_write sets
-- `_v` to EXACTLY `coalesce(old _v, 0) + 1` and writes whatever `_saveId`
-- the client sent -- a brand-new id every call (js/01-sync-core.js,
-- saveToCloud(): `Date.now().toString(36) + Math.random().toString(36)
-- .slice(2)`, passed through by store-proxy with no server-side
-- regeneration). So a real client write has BOTH of these true at once:
--   (a) `_saveId` differs from what was already stored, AND
--   (b) `_v` is exactly `old _v + 1`
-- A write missing EITHER property did not go through store_cas_write with
-- a real client payload -- it's a manual SQL edit (or a vanishingly
-- unlikely two-call id collision, a risk already assessed as negligible
-- and unchanged by this migration). This trigger flags on EITHER failing,
-- not just (a), which is what the first draft got wrong: an operator who
-- changes `_saveId` but leaves `_v` alone would have sailed through a
-- same-id-only check untouched, then been silently overwritten by the
-- next ordinary save from any device still at the old version -- the
-- exact failure case the original HANDOFF rule was written to prevent.
--
-- WHAT THIS DOES NOT CHANGE:
-- - No client-visible behavior changes for any normal save. Both
--   conditions are false for every write that goes through
--   store_cas_write with a real client payload, which is every save the
--   app ever makes (confirmed: store_cas_write is the only writer of
--   `store` anywhere in this codebase -- no other migration or edge
--   function touches it).
-- - store_cas_write's own returned `new_data` (what the client making
--   that exact call sees) is computed before this trigger runs, so this
--   can never change what an unrelated earlier call already reported to
--   its own caller -- it only changes what the NEXT read of the row
--   sees, which is the point: the next legitimate save or load must see
--   the corrected, unmistakably-manual state, not the original one.
-- - A manual edit that deliberately mints a fresh, non-sentinel `_saveId`
--   AND bumps `_v` by exactly 1 looks identical to a real client write
--   and is not caught. That's an accepted scope limit, not a gap: the
--   threat model here is an honest operator mistake (Cowork/Tanish
--   editing `store` directly), not an adversary -- anyone who could
--   craft such a write already has service-role database access.
-- ══════════════════════════════════════════════════════════════════════

create or replace function public._guard_manual_store_edit()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_old_saveid text;
  v_new_saveid text;
  v_old_v integer;
  v_new_v integer;
begin
  v_old_saveid := OLD.data->>'_saveId';
  v_new_saveid := NEW.data->>'_saveId';
  v_old_v := coalesce((OLD.data->>'_v')::integer, 0);
  v_new_v := (NEW.data->>'_v')::integer; -- left null if absent; coalesced only below

  -- `is not distinct from` (not plain =) so two manual edits in a row,
  -- both leaving `_saveId` at JSON null, still count as "unchanged" --
  -- plain `=` treats null = null as unknown (not true) and would let a
  -- second null-on-null manual edit straight through unflagged.
  if v_new_saveid is not distinct from v_old_saveid
     or v_new_v is distinct from v_old_v + 1 then
    NEW.data := NEW.data || jsonb_build_object(
      '_saveId', 'manual-' || clock_timestamp()::text,
      '_v', greatest(coalesce(v_new_v, v_old_v), v_old_v + 1)
    );
  end if;

  return NEW;
end;
$$;

-- No `security definer` needed: this trigger only runs as part of a
-- statement someone is already permitted to issue against `store` --
-- service_role via store_cas_write, or a superuser/service_role manual
-- edit. It doesn't need to, and must not, grant anyone new access.
revoke all on function public._guard_manual_store_edit() from public;
revoke all on function public._guard_manual_store_edit() from anon;
revoke all on function public._guard_manual_store_edit() from authenticated;

drop trigger if exists _guard_manual_store_edit on public.store;
create trigger _guard_manual_store_edit
  before update on public.store
  for each row
  -- Skip updates that don't actually touch `data` (e.g. a hypothetical
  -- future `update store set updated_at = now()`) -- store_cas_write
  -- always changes `data` on a real write, so this only ever skips a
  -- genuine no-op, never a real client save.
  when (OLD.data is distinct from NEW.data)
  execute function public._guard_manual_store_edit();

-- ── NOTES ────────────────────────────────────────────────────────────
-- Additive and idempotent (CREATE OR REPLACE FUNCTION, DROP TRIGGER IF
-- EXISTS before CREATE), safe to rerun. Does not touch any existing row's
-- current data -- it only changes what a FUTURE update to a row looks
-- like, and only for updates that already qualify as "not a real client
-- write" by the test above. Requires `store` to already exist (it does,
-- since 001_lockdown_rls.sql) -- same assumption that migration already
-- makes.
--
-- Known limitation this does NOT and cannot fix: if a client's save
-- landed, then an operator pastes back an older, manually-edited blob
-- that predates it, that in-between client save is still gone -- the
-- pasted blob never contained it, and no trigger can merge back data
-- that was never in the write it's checking. What this migration DOES
-- guarantee is that `_v` can never go backwards and the edit is always
-- labelled `manual-...`, so the loss is visible and traceable instead of
-- silent -- it turns a silent, untraceable loss into a visible,
-- after-the-fact one.
--
-- Manual verification (Backend Architect review, 9/10 Oct -- run these
-- wrapped in `begin; ... rollback;` against a disposable/test shop id
-- that has been saved from the real app at least once already, so it
-- has a `_v` to begin with -- NEVER against a real shop's row):
--
--   begin;
--
--   -- 1. A normal client-shaped update (new _saveId AND _v = old+1)
--   --    must pass through unmodified:
--   update store set data = data || jsonb_build_object('_saveId','client-test-1','_v',(data->>'_v')::int + 1)
--     where id = '<test-shop-id>';
--   select data->>'_saveId', data->>'_v' from store where id = '<test-shop-id>';
--   -- expect: _saveId = 'client-test-1', _v = old value + 1, untouched by the trigger
--
--   -- 2. A manual edit that forgets BOTH _saveId and _v (the most
--   --    common accidental case -- just editing a field and saving)
--   --    must come back corrected:
--   update store set data = jsonb_set(data, '{someTestField}', '"x"') where id = '<test-shop-id>';
--   select data->>'_saveId', data->>'_v' from store where id = '<test-shop-id>';
--   -- expect: _saveId now starts with 'manual-', _v bumped by exactly 1
--
--   -- 3. A manual edit that sets a fresh _saveId but forgets to bump _v
--   --    (the case the first draft of this migration missed) must ALSO
--   --    come back corrected:
--   update store set data = data || jsonb_build_object('_saveId','looks-like-a-client-write')
--     where id = '<test-shop-id>';
--   select data->>'_saveId', data->>'_v' from store where id = '<test-shop-id>';
--   -- expect: _saveId overwritten to 'manual-...' (the fresh id alone wasn't enough), _v bumped by exactly 1
--
--   rollback; -- leaves nothing behind on the test shop either way
--
--   -- 4. After applying this for real (not inside a rolled-back
--   --    transaction), do ONE normal save from the actual app against
--   --    this test shop, then check it was NOT flagged -- this is the
--   --    most important check, because 1-3 only imitate a client write;
--   --    this proves it end to end through store-proxy + store_cas_write:
--   select data->>'_saveId', data->>'_v' from store where id = '<test-shop-id>';
--   -- expect: _saveId is NOT 'manual-...', _v went up by exactly 1
--
--   -- Rollback for this whole migration, if ever needed (it never
--   -- touches existing rows, so dropping the trigger fully reverts its
--   -- effect on every future write):
--   -- drop trigger if exists _guard_manual_store_edit on public.store;
