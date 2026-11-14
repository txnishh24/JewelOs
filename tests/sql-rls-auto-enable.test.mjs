// Runs migration 015 (DRAFT, not applied to the live project) against real Postgres (PGlite).
// The function body and event trigger below are copied from the live project (read-only, 14 Nov 2026).
// Proves: before 015 anon and authenticated can execute it (the advisor warning); after 015 they cannot
// and neither can a plain role (PUBLIC revoked); the event trigger STILL turns on RLS for a new public
// table; service_role and the owner keep EXECUTE; running 015 twice is harmless.
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import { fileURLToPath } from 'url';

const db = new PGlite();
const R = fileURLToPath(new URL('../supabase/migrations/', import.meta.url));
const ok = (c, m) => { if (!c) { console.log('FAIL', m); process.exitCode = 1; } else console.log('ok  ', m); };

await db.exec(`create role anon; create role authenticated; create role service_role; create role someone;
  grant usage, create on schema public to anon, authenticated, service_role, someone;`);
await db.exec(`
CREATE OR REPLACE FUNCTION public.rls_auto_enable()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$;
CREATE EVENT TRIGGER ensure_rls ON ddl_command_end WHEN TAG IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO') EXECUTE FUNCTION public.rls_auto_enable();
`);
// Supabase leaves new functions executable by PUBLIC and the API roles; reproduce the live grants
await db.exec(`grant execute on function public.rls_auto_enable() to public, anon, authenticated, service_role;`);

const can = async (role) => (await db.query(`select has_function_privilege($1, 'public.rls_auto_enable()', 'execute') as x`, [role])).rows[0].x;
const rls = async (t) => (await db.query(`select relrowsecurity as x from pg_class where oid = $1::regclass`, ['public.' + t])).rows[0].x;

ok(await can('anon') && await can('authenticated') && await can('someone'), 'before 015: anon, authenticated and a plain role can execute it (the advisor warning)');
await db.exec(`create table public.before_t (id int);`);
ok(await rls('before_t'), 'before 015: a new public table gets RLS from the trigger');

const sql = fs.readFileSync(R + '015_revoke_rls_auto_enable_execute.sql', 'utf8');
await db.exec(sql);
ok(!(await can('anon')), 'after 015: anon cannot execute it');
ok(!(await can('authenticated')), 'after 015: authenticated cannot execute it');
ok(!(await can('someone')), 'after 015: a plain role cannot execute it either (PUBLIC revoked)');
ok(await can('service_role'), 'after 015: service_role keeps EXECUTE');
ok(await can('postgres'), 'after 015: the owner keeps EXECUTE');

await db.exec(`create table public.after_t (id int);`);
ok(await rls('after_t'), 'after 015: a new public table STILL gets RLS enabled by the event trigger');
await db.exec(`set role someone; create table public.after_t2 (id int); reset role;`);
ok(await rls('after_t2'), 'after 015: a table created by an ordinary role still gets RLS (the trigger runs as its owner)');

let err = null;
try { await db.exec(`set role anon; select public.rls_auto_enable(); reset role;`); } catch (e) { err = e; await db.exec('reset role'); }
ok(err !== null, 'after 015: calling it as anon is refused: ' + (err && err.message));

await db.exec(sql);
ok(!(await can('anon')) && await can('service_role'), 'running 015 twice changes nothing');
