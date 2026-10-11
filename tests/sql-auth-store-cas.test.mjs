// Runs migration 008 (auth_store CAS + history) against real Postgres
// (PGlite, in-process WASM) — proves the SQL itself, not the Edge Function
// wiring (that's tests/edge-functions.test.js's job).
// Not in npm deps on purpose — one-off: npm i --no-save @electric-sql/pglite@0.2 && node tests/sql-auth-store-cas.test.mjs
//
// Limit: PGlite is a single connection, so this can't exercise the `for
// update` lock under real concurrency. The "different-part race" test
// below simulates two writers taking turns by hand (A's CAS call, then B's
// CAS call against the version A left behind) — it proves the version-
// compare-and-retry LOGIC, not the lock itself. The lock is the same
// Postgres guarantee store_cas_write (002) and consume_password_reset_code
// (003) already rely on.
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import { fileURLToPath } from 'url';

const db = new PGlite();
const R = fileURLToPath(new URL('../supabase/migrations/', import.meta.url));

await db.exec(`create role anon; create role authenticated; create role service_role;
  create table public.auth_store (id text primary key, data jsonb, updated_at timestamptz default now());`);
await db.exec(fs.readFileSync(R + '008_auth_store_cas_history.sql', 'utf8'));

const ok = (c, m) => { if (!c) { console.log('FAIL', m); process.exitCode = 1; } else console.log('ok  ', m); };
const cas = async (id, data, expectedVersion, actor) => {
  const r = await db.query(
    `select * from auth_store_cas_write($1,$2,$3,$4)`,
    [id, JSON.stringify(data), expectedVersion, actor ?? null],
  );
  return r.rows[0];
};
const row = async (id) => (await db.query('select data, version from auth_store where id=$1', [id])).rows[0];
const historyCount = async () => Number((await db.query('select count(*) c from auth_store_history')).rows[0].c);

await db.query(`insert into auth_store (id, data) values ('users', $1), ('shops', $2)`,
  [JSON.stringify([{ id: 'u1' }, { id: 'u2' }]), JSON.stringify([{ id: 's1' }])]);

// 1. Fresh row starts at version 0; a correct-version CAS writes and bumps to 1.
{
  const before = await row('users');
  ok(before.version === 0, 'existing row starts at version 0');
  const r = await cas('users', [{ id: 'u1' }, { id: 'u2' }, { id: 'u3' }], 0, 'test:add');
  ok(r.ok === true && r.conflict === false, 'CAS with the correct expected version succeeds');
  ok(r.cur_version === 1, 'cur_version is 1 after the first write');
}

// 2. Stale write: same expected version again must conflict, not overwrite.
{
  const beforeRow = await row('users');
  const r = await cas('users', [{ id: 'u1' }, { id: 'u2' }, { id: 'u3' }, { id: 'u4' }], 0, 'test:stale');
  ok(r.ok === false && r.conflict === true, 'a stale expected version conflicts');
  ok(r.cur_version === 1, 'conflict reports the real current version (1)');
  ok(JSON.stringify(r.current_data) === JSON.stringify(beforeRow.data), 'conflict hands back the actual stored array');
  const after = await row('users');
  ok(JSON.stringify(after.data) === JSON.stringify(beforeRow.data), 'the row itself is unchanged after a conflicting write');
}
const historyAfterConflict = await historyCount();
ok(historyAfterConflict === 1, 'a conflicting write adds NO history row (only the one real write from step 1 so far)');

// 3. Different-part race, simulated by hand: A and B both start from v1.
//    A appends u3... already did in step 1, that WAS "A". Now do a fresh
//    pair on 'shops' so the numbers are clean: A adds s2, B (racing on the
//    same v0) tries to add s3 instead, conflicts, re-applies on A's result.
{
  const a = await cas('shops', [{ id: 's1' }, { id: 's2' }], 0, 'test:writerA');
  ok(a.ok === true && a.cur_version === 1, 'writer A lands first, version 1');
  const bAttempt = await cas('shops', [{ id: 's1' }, { id: 's3' }], 0, 'test:writerB-first-try');
  ok(bAttempt.ok === false && bAttempt.conflict === true, 'writer B (still on v0) conflicts against A\'s write');
  // B re-applies its own change (adding s3) on top of what's actually there now.
  const rebuilt = bAttempt.current_data.concat([{ id: 's3' }]);
  const bRetry = await cas('shops', rebuilt, bAttempt.cur_version, 'test:writerB-retry');
  ok(bRetry.ok === true && bRetry.cur_version === 2, 'writer B\'s retry succeeds on the fresh version');
  const final = await row('shops');
  const ids = final.data.map((x) => x.id).sort();
  ok(JSON.stringify(ids) === JSON.stringify(['s1', 's2', 's3']), 'both writers\' changes survive: s1, s2 AND s3 all present');
}

// 4. One history row per successful write. By now: step 1 (1 write), step 3
//    (2 writes: A and B's retry) = 3 history rows total. Step 2's conflict
//    added none.
{
  const rows = (await db.query(
    `select row_id, old_version, new_version, actor from auth_store_history order by id`,
  )).rows;
  ok(rows.length === 3, 'exactly 3 history rows for the 3 successful writes so far (got ' + rows.length + ')');
  ok(rows[0].old_version === 0 && rows[0].new_version === 1 && rows[0].actor === 'test:add', 'row 1: users 0->1, actor recorded');
  ok(rows[1].old_version === 0 && rows[1].new_version === 1 && rows[1].actor === 'test:writerA', 'row 2: shops 0->1, writer A');
  ok(rows[2].old_version === 1 && rows[2].new_version === 2 && rows[2].actor === 'test:writerB-retry', 'row 3: shops 1->2, writer B\'s retry (not the failed first try)');
}

// 5. A manual update (no function, no actor) still bumps version and logs actor NULL.
{
  const before = await row('shops');
  await db.query(`update auth_store set data = data || $1::jsonb where id='shops'`, [JSON.stringify([{ id: 'manual' }])]);
  const after = await row('shops');
  ok(after.version === before.version + 1, 'a manual edit still bumps version by exactly 1');
  const last = (await db.query(`select actor from auth_store_history order by id desc limit 1`)).rows[0];
  ok(last.actor === null, 'a manual edit logs actor = NULL (untracked write), not a fabricated string');
}

// 6. A manual edit that tries to set version=0 explicitly still can't rewind it —
//    the trigger always computes NEW.version from OLD.version + 1, ignoring
//    whatever the UPDATE statement itself set.
{
  const before = await row('shops');
  await db.query(`update auth_store set data = data || $1::jsonb, version = 0 where id='shops'`, [JSON.stringify([{ id: 'rewind-attempt' }])]);
  const after = await row('shops');
  ok(after.version === before.version + 1, 'version cannot be rewound by a manual edit that tries to set it to 0 (got ' + after.version + ', expected ' + (before.version + 1) + ')');
}

// 7. Rejections.
{
  let threw = false;
  try { await cas('users', { not: 'an array' }, 1, 'test:bad-shape'); } catch (e) { threw = true; }
  ok(threw, 'a non-array p_data raises (an object would append a fake user)');

  threw = false;
  try { await cas('users', null, 1, 'test:null'); } catch (e) { threw = true; }
  ok(threw, 'a null p_data raises');

  threw = false;
  try { await cas('x', [], 0, 'test:bad-id'); } catch (e) { threw = true; }
  ok(threw, 'an unknown p_id raises');

  const current = await row('users');
  const bigDrop = current.data.slice(0, current.data.length - 2); // drops 2
  threw = false;
  try { await cas('users', bigDrop, current.version, 'test:big-drop'); } catch (e) { threw = true; }
  ok(threw, 'a write dropping 2+ records in one call raises, instead of silently wiping the platform');
}

// 8. No-op write: same array content, version unchanged, no new history row.
{
  const before = await row('users');
  const beforeHistory = await historyCount();
  const r = await cas('users', before.data, before.version, 'test:noop');
  ok(r.ok === true, 'an identical-content write still reports ok');
  const after = await row('users');
  ok(after.version === before.version, 'a no-op write (same data) does not bump the version');
  ok((await historyCount()) === beforeHistory, 'a no-op write adds no history row (the trigger only fires when data actually differs)');
}

// 9. Retention: a 31-day-old row gets pruned on the next write; recent rows stay.
{
  await db.query(`insert into auth_store_history (row_id, old_version, new_version, old_data, actor, created_at)
    values ('users', 0, 1, '[]'::jsonb, 'test:ancient', now() - interval '31 days')`);
  const beforeCount = await historyCount();
  const current = await row('users');
  // Must be a REAL data change, not a no-op — the trigger (and its pruning
  // delete) only fires `when (OLD.data IS DISTINCT FROM NEW.data)`.
  await cas('users', current.data.concat([{ id: 'retention-probe' }]), current.version, 'test:trigger-pruning');
  const ancientStillThere = (await db.query(`select 1 from auth_store_history where actor = 'test:ancient'`)).rows.length;
  ok(ancientStillThere === 0, 'a 31-day-old history row is pruned by the next write\'s trigger');
  const afterCount = await historyCount();
  ok(afterCount > 0, 'recent history rows are NOT pruned (count is still ' + afterCount + ', not 0)');
}
