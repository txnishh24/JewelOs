// Runs migration 009 (login_throttle) against real Postgres (PGlite,
// in-process WASM) — proves the SQL itself, not the Edge Function wiring
// (that's tests/edge-functions.test.js's job).
// Not in npm deps on purpose — one-off: npm i --no-save @electric-sql/pglite@0.2 && node tests/sql-login-throttle.test.mjs
//
// Limit: PGlite is a single connection, so this can't exercise the `for
// update` lock under real concurrent sessions. That guarantee rests on the
// same Postgres semantics 002 and 003 already rely on; the only real proof
// of the race fix is the post-deploy live check (docs/login-lockout-design.md
// section 7.3).
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import { fileURLToPath } from 'url';

const db = new PGlite();
const R = fileURLToPath(new URL('../supabase/migrations/', import.meta.url));

await db.exec(`create role anon; create role authenticated; create role service_role;`);
await db.exec(fs.readFileSync(R + '009_login_throttle.sql', 'utf8'));

const ok = (c, m) => { if (!c) { console.log('FAIL', m); process.exitCode = 1; } else console.log('ok  ', m); };
const take = async (key, maxFail = 5, baseLock = 15, maxLock = 1440) =>
  (await db.query('select login_throttle_take($1,$2,$3,$4) v', [key, maxFail, baseLock, maxLock])).rows[0].v;
const row = async (key) => (await db.query('select * from login_throttle where key=$1', [key])).rows[0];

// 1. First 4 calls on a fresh key go ahead (return 0). The 5th also goes
//    ahead (it might be the right password) but sets the lock.
{
  for (let i = 1; i <= 4; i++) {
    ok(await take('e:a') === 0, `call ${i} on a fresh key returns 0 (goes ahead)`);
  }
  ok(await take('e:a') === 0, 'the 5th call still returns 0 (this attempt is still checked)');
  const r = await row('e:a');
  ok(r.locked_until !== null, 'the 5th call sets locked_until');
  const minsAhead = (new Date(r.locked_until).getTime() - Date.now()) / 60000;
  ok(minsAhead > 14 && minsAhead <= 15.1, 'locked_until is roughly 15 minutes out (got ' + minsAhead.toFixed(2) + ' min)');
}

// 2. The 6th call (now locked) is refused without being counted.
{
  const before = await row('e:a');
  const wait = await take('e:a');
  ok(wait >= 899 && wait <= 900, 'the 6th call is refused with ~900s remaining (got ' + wait + ')');
  const after = await row('e:a');
  ok(after.failures === before.failures && after.lockouts === before.lockouts, 'a refused attempt does not change failures/lockouts');
}

// 3. Escalation: force the lock to have already expired, then run the cycle
//    again -- the SECOND lock in a row should be 30 minutes, not 15.
{
  await db.query(`update login_throttle set locked_until = now() - interval '1 second' where key='e:a'`);
  for (let i = 0; i < 4; i++) await take('e:a');
  await take('e:a'); // 5th
  const r = await row('e:a');
  const minsAhead = (new Date(r.locked_until).getTime() - Date.now()) / 60000;
  ok(minsAhead > 29 && minsAhead <= 30.1, 'the second lock in a row is ~30 minutes (got ' + minsAhead.toFixed(2) + ' min)');
  ok(r.lockouts === 2, 'lockouts counter is now 2');
}

// 4. A third lock in a row escalates to 60 minutes.
{
  await db.query(`update login_throttle set locked_until = now() - interval '1 second' where key='e:a'`);
  for (let i = 0; i < 5; i++) await take('e:a');
  const r = await row('e:a');
  const minsAhead = (new Date(r.locked_until).getTime() - Date.now()) / 60000;
  ok(minsAhead > 59 && minsAhead <= 60.1, 'the third lock in a row is ~60 minutes (got ' + minsAhead.toFixed(2) + ' min)');
}

// 5. The cap: with lockouts already at 7, the next lock must be capped at
//    1440 minutes (24h), not 15 * 2^7 = 1920. With lockouts at 20, still 1440
//    (no overflow from a huge exponent).
{
  await db.query(`update login_throttle set lockouts=7, locked_until = now() - interval '1 second', failures=0 where key='e:a'`);
  for (let i = 0; i < 5; i++) await take('e:a');
  let r = await row('e:a');
  let minsAhead = (new Date(r.locked_until).getTime() - Date.now()) / 60000;
  ok(minsAhead > 1439 && minsAhead <= 1440.1, 'lockouts=7 still caps at 1440 min, not 1920 (got ' + minsAhead.toFixed(2) + ')');

  await db.query(`update login_throttle set lockouts=20, locked_until = now() - interval '1 second', failures=0 where key='e:a'`);
  for (let i = 0; i < 5; i++) await take('e:a');
  r = await row('e:a');
  minsAhead = (new Date(r.locked_until).getTime() - Date.now()) / 60000;
  ok(minsAhead > 1439 && minsAhead <= 1440.1, 'lockouts=20 still caps at 1440 min — no exponent overflow (got ' + minsAhead.toFixed(2) + ')');
}

// 6. Quiet reset: 25 hours of silence resets failures/lockouts to a fresh
//    start; 23 hours does NOT reset.
{
  await db.query(`update login_throttle set failures=3, lockouts=4, locked_until=null,
    last_attempt_at = now() - interval '25 hours' where key='e:a'`);
  await take('e:a');
  let r = await row('e:a');
  ok(r.failures === 1 && r.lockouts === 0, '25h of quiet resets to failures=1 (this call), lockouts=0 (got failures=' + r.failures + ', lockouts=' + r.lockouts + ')');

  await db.query(`update login_throttle set failures=3, lockouts=4, locked_until=null,
    last_attempt_at = now() - interval '23 hours' where key='e:a'`);
  await take('e:a');
  r = await row('e:a');
  ok(r.failures === 4 && r.lockouts === 4, '23h of quiet does NOT reset (failures keeps counting: got failures=' + r.failures + ', lockouts=' + r.lockouts + ')');
}

// 7. Independence: locking 'e:a' does not touch 'e:b' or a device-token key.
{
  await db.query(`update login_throttle set failures=0, lockouts=0, locked_until = now() + interval '1 hour' where key='e:a'`);
  ok(await take('e:b') === 0, "a different email's key is unaffected by e:a's lock");
  ok(await take('d:a|some-device-id') === 0, "a device-token key for the SAME email is a separate row, unaffected by e:a's lock");
}

// 8. A successful login deletes the row (modelled here as the caller
//    deleting it directly, same as auth-gateway's login route does) —
//    confirm the row is gone and the next call starts completely fresh.
{
  await db.query(`delete from login_throttle where key = 'e:fresh'`);
  for (let i = 0; i < 4; i++) await take('e:fresh');
  await db.query(`delete from login_throttle where key = 'e:fresh'`); // "success"
  const gone = (await db.query(`select 1 from login_throttle where key='e:fresh'`)).rows.length;
  ok(gone === 0, 'the row is gone after a simulated success-clear');
  ok(await take('e:fresh') === 0, 'the next call after a clear starts fresh (0 failures so far, well under the cap)');
  const r = await row('e:fresh');
  ok(r.failures === 1, 'confirmed: failures restarted at 1, not continuing the old count');
}

// 9. Best effort: anon/authenticated cannot call the function directly.
{
  let threw = false;
  try {
    await db.exec(`set role anon;`);
    await db.query(`select login_throttle_take('e:probe', 5, 15, 1440)`);
  } catch (e) { threw = true; } finally { await db.exec(`reset role;`); }
  ok(threw, 'anon is refused execute on login_throttle_take');
}
