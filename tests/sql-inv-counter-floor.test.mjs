// Runs the invoice counter (002 table, then 004, 005, 006 — the order production
// sees) against real Postgres (PGlite, in-process WASM).
// Not in npm deps on purpose — one-off: npm i --no-save @electric-sql/pglite@0.2 && node tests/sql-inv-counter-floor.test.mjs
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import { fileURLToPath } from 'url';
const db = new PGlite();
const R = fileURLToPath(new URL('../supabase/migrations/', import.meta.url));
await db.exec(`create role anon; create role authenticated; create role service_role;
  create table public.store (id text primary key, data jsonb, updated_at timestamptz default now());`);
const m2 = fs.readFileSync(R+'002_atomic_transactions.sql','utf8');
await db.exec(m2.slice(m2.indexOf('-- ── COUNTERS TABLE'), m2.indexOf('-- ── TRUE ATOMIC COMPARE-AND-SWAP')));
await db.exec(fs.readFileSync(R+'004_inv_counter_floor.sql','utf8'));
await db.exec(fs.readFileSync(R+'005_inv_counter_floor_from_bills.sql','utf8'));
await db.exec(fs.readFileSync(R+'006_inv_counter_floor_bill_cap.sql','utf8'));
const inc = async (s,c) => (await db.query('select increment_shop_counter($1,$2) v',[s,c])).rows[0].v;
const ok = (c,m) => { if(!c){ console.log('FAIL', m); process.exitCode=1; } else console.log('ok  ', m); };
const shop = async (id, data, counter) => {
  await db.query('insert into store (id,data) values ($1,$2)', [id, JSON.stringify(data)]);
  if (counter != null) await db.query(`insert into counters values ($1,$1,'inv_no',$2,now())`.replace('$1,$1', `$1 || '_inv_no', $1`), [id, counter]);
};
const bills = (...nos) => nos.map((n) => ({ invNo: n }));

await shop('A', { sales: bills('INV-031','INV-032','INV-033'), nextInvNo: 34 }, 30);
ok(await inc('A','inv_no')===34, 'counter behind the real bills catches up (30 -> 34)');
ok(await inc('A','inv_no')===35, 'then carries on (35)');

// Opus item 1: a bad saved nextInvNo is no longer read at all.
await shop('B', { sales: bills('INV-031'), nextInvNo: 1500 }, 499);
ok(await inc('B','inv_no')===500, 'a bad nextInvNo (1500) near the counter causes no jump: 499 -> 500');
ok(await inc('B','inv_no')===501, 'and never later either (501)');

// Opus item 2: honest lag > 1000, and >1000 bills with no counter row.
await shop('C', { sales: bills('INV-2500') }, 30);
// 006: with a counter row, a bill >1000 above it is ignored (the app skips it if the counter ever reaches it).
ok(await inc('C','inv_no')===31, '006: one bill ~2500 above a live counter is ignored (30 -> 31)');
await shop('C2', { sales: bills('INV-031','INV-999999999') }, 30);
ok(await inc('C2','inv_no')===32, '006: a crafted INV-999999999 bill cannot jump the series (-> 32, after the real INV-031)');
await shop('D', { sales: Array.from({length: 1500}, (_, i) => ({ invNo: 'INV-' + String(i+1).padStart(3,'0') })) });
ok(await inc('D','inv_no')===1501, 'a restored shop with 1500 bills and no counter row starts at 1501');

// Only the INV-<digits> format counts; typed numbers move nothing.
await shop('E', { sales: bills('2025-26/001','9876543210','A/15', null, 'INV-12') , nextInvNo: 202526002 }, 30);
ok(await inc('E','inv_no')===31, 'FY-style, phone-number and other typed numbers are ignored: 30 -> 31');
await shop('F', { sales: bills(' inv-0040 ') }, 10);
ok(await inc('F','inv_no')===41, 'case, spaces and leading zeros are ignored: " inv-0040 " -> 41');
await shop('G', { sales: bills('INV-99999999999') }, 30);
ok(await inc('G','inv_no')===31, 'a bill number over 9 digits is ignored — no overflow');

// Shapes that must not break.
ok(await inc('H','inv_no')===1, 'no saved shop at all: starts at 1');
await shop('I', { sales: 'oops' }, 5);
ok(await inc('I','inv_no')===6, 'a sales field that is not a list is ignored (5 -> 6)');
await shop('J', {}, null);
ok(await inc('J','inv_no')===1, 'a shop with no sales starts at 1');
ok(await inc('J','inv_no')===2, 'then 2');

// Other counters untouched.
await shop('K', { sales: bills('INV-900') }, null);
ok(await inc('K','girvi_no')===1, 'girvi_no ignores invoice bills');
