// Runs migrations 002 + 007 + 011 against real Postgres (PGlite) and proves the store_history
// safety net: normal saves keep at most one copy per 6 hours, a shrinking save is always
// captured, only 4 copies per shop are kept, and a restore from a copy works.
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import { fileURLToPath } from 'url';

const db = new PGlite();
const R = fileURLToPath(new URL('../supabase/migrations/', import.meta.url));
await db.exec(`create role anon; create role authenticated; create role service_role;
  create table public.store (id text primary key, data jsonb, updated_at timestamptz default now());`);
for (const f of ['002_atomic_transactions.sql', '007_manual_store_edit_guard.sql', '013_store_history.sql']) {
  await db.exec(fs.readFileSync(R + f, 'utf8'));
}

const ok = (c, m) => { if (!c) { console.log('FAIL', m); process.exitCode = 1; } else console.log('ok  ', m); };
const blob = (n, extra) => ({ sales: Array.from({ length: n }, (_, i) => ({ id: i })), girvi: [], products: [], customers: [], ...extra });
const save = async (shop, data, ev) => (await db.query('select * from store_cas_write($1,$2,$3)', [shop, JSON.stringify(data), ev])).rows[0];
const hist = async (shop) => (await db.query('select * from store_history where shop_id=$1 order by id', [shop])).rows;
const age = (shop, hours) => db.query(`update store_history set created_at = now() - ($2 || ' hours')::interval where shop_id=$1`, [shop, String(hours)]);

// 1. first save creates the row: nothing to copy yet
await save('A', blob(10), 0);
ok((await hist('A')).length === 0, 'a brand-new shop has no history yet');

// 2. first update after that copies the old blob; further saves within 6h do not
await save('A', blob(11), 1);
let h = await hist('A');
ok(h.length === 1 && h[0].old_version === 1 && h[0].old_data.sales.length === 10, 'first update keeps the previous blob (v1, 10 sales)');
await save('A', blob(12), 2);
await save('A', blob(13), 3);
ok((await hist('A')).length === 1, 'normal saves inside 6 hours add no further copies');

// 3. after 6 hours the next save is copied again
await age('A', 7);
await save('A', blob(14), 4);
h = await hist('A');
ok(h.length === 2 && h[1].old_data.sales.length === 13, 'a save after 6h copies the blob as it was just before that save');

// 4. a shrinking save is captured even inside the 6h window
await save('A', blob(2), 5);
h = await hist('A');
ok(h.length === 3 && h[2].old_data.sales.length === 14, 'a save that drops sales 14 -> 2 keeps the 14-sale blob');

// 5. small deletes (under 20% loss, or tiny lists) are not treated as shrinking
await save('B', blob(20), 0);
await save('B', blob(21), 1);
const nB = (await hist('B')).length;
await save('B', blob(18), 2); // 21 -> 18 = 86% kept
ok((await hist('B')).length === nB, 'deleting a couple of bills is not flagged');
await save('C', blob(3), 0);
await save('C', blob(4), 1);
const nC = (await hist('C')).length;
await save('C', blob(0), 2); // old list under 5 records
ok((await hist('C')).length === nC, 'lists under 5 records are never flagged');

// 6. only the newest 4 copies per shop are kept
const cur = Number((await db.query(`select data->>'_v' v from store where id='A'`)).rows[0].v);
let v = cur;
for (let i = 0; i < 6; i++) { await save('A', blob(60 + i * 10), v); v++; await save('A', blob(1), v); v++; }
h = await hist('A');
ok(h.length === 4, 'history is capped at 4 copies per shop');
ok(h.every((r) => r.shop_id === 'A'), 'pruning never touches another shop');
ok((await hist('B')).length === nB, 'shop B history untouched by A pruning');

// 7. restore from a copy
const pick = h[h.length - 1];
await db.query(`update store set data = $1 where id='A'`, [JSON.stringify(pick.old_data)]);
const restored = (await db.query(`select data from store where id='A'`)).rows[0].data;
ok(restored.sales.length === pick.old_data.sales.length, 'manual restore from a copy brings the old sales back');
ok(typeof restored._saveId === 'string' && restored._saveId.startsWith('manual-'), 'the 007 guard marks the restore so open phones reload');

// 8. clients cannot read it
const priv = await db.query(`select has_table_privilege('anon','public.store_history','select') a,
  has_table_privilege('authenticated','public.store_history','select') b`);
ok(priv.rows[0].a === false && priv.rows[0].b === false, 'anon and authenticated cannot read store_history');

console.log(process.exitCode ? '\nFAILED' : '\nall passed');
