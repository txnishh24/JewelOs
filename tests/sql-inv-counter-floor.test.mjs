// Runs supabase/migrations/004 against real Postgres (PGlite, in-process WASM).
// Not in npm deps on purpose — one-off: npm i --no-save @electric-sql/pglite@0.2 && node tests/sql-inv-counter-floor.test.mjs
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import { fileURLToPath } from 'url';
const db = new PGlite();
const R = fileURLToPath(new URL('../supabase/migrations/', import.meta.url));
await db.exec(`create role anon; create role authenticated; create role service_role;
  create table public.store (id text primary key, data jsonb, updated_at timestamptz default now());`);
// 002's counters table + old function, then 004 on top — as the live DB will see it
const m2 = fs.readFileSync(R+'002_atomic_transactions.sql','utf8');
await db.exec(m2.slice(m2.indexOf('-- ── COUNTERS TABLE'), m2.indexOf('-- ── TRUE ATOMIC COMPARE-AND-SWAP')));
await db.exec(fs.readFileSync(R+'004_inv_counter_floor.sql','utf8'));
const inc = async (s,c) => (await db.query('select increment_shop_counter($1,$2) v',[s,c])).rows[0].v;
const ok = (c,m) => { if(!c){ console.log('FAIL', m); process.exitCode=1; } else console.log('ok  ', m); };
// shop A: counter at 30, blob says next free is 34
await db.query(`insert into counters values ('A_inv_no','A','inv_no',30,now())`);
await db.query(`insert into store (id,data) values ('A','{"nextInvNo":34}')`);
ok(await inc('A','inv_no')===34, 'counter behind the blob jumps to the next free number (34)');
ok(await inc('A','inv_no')===35, 'then carries on from there (35)');
// blob behind counter: no effect
await db.query(`update store set data='{"nextInvNo":3}' where id='A'`);
ok(await inc('A','inv_no')===36, 'a lower floor never pulls the counter back (36)');
// brand new shop, no counter row, blob at 12
await db.query(`insert into store (id,data) values ('B','{"nextInvNo":12}')`);
ok(await inc('B','inv_no')===12, 'first-ever call for a shop starts at its next free number (12)');
// no store row / no nextInvNo / string value
ok(await inc('C','inv_no')===1, 'no saved data: starts at 1 as before');
await db.query(`insert into store (id,data) values ('D','{"nextInvNo":"99"}')`);
ok(await inc('D','inv_no')===1, 'a non-number nextInvNo is ignored');
await db.query(`insert into store (id,data) values ('E','{"nextInvNo":1e12}')`);
ok(await inc('E','inv_no')===2147483647, 'a huge nextInvNo is capped, not an overflow error');
// other counters untouched by the floor
await db.query(`update store set data='{"nextInvNo":500,"nextGirviId":500}' where id='A'`);
ok(await inc('A','girvi_no')===1, 'girvi_no ignores the invoice floor');
