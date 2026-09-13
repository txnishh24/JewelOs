// Edge Function tests — runs the REAL auth-gateway and store-proxy handlers
// in Node against an in-memory fake of Supabase: sign up, log in, get a
// genuinely signed token, then exercise store-proxy with it.
//
//   node tests/edge-functions.test.js
//
// Covers the 14 Sep security fixes (reset-code guess cap, removed staff cut
// off, role from the current record) plus the unchanged happy paths. Run it
// before deploying any change to supabase/functions/.
//
// Not zero-dependency like regression.test.js: it needs `sucrase` to strip
// TypeScript. Found via `require('sucrase')`, then $SUCRASE_PATH, then the
// copy bundled inside a global expo-cli install. Skips (exit 0) if none.
//
// Limit: the database is faked. consume_password_reset_code is modelled in
// JS below, so this proves the Edge Function wiring and the algorithm, NOT
// the SQL in migrations/003 or its locking under concurrent requests.
var fs = require('fs'), vm = require('vm'), path = require('path');
var webcrypto = require('crypto').webcrypto;
var sucrase = (function () {
  var tries = ['sucrase', process.env.SUCRASE_PATH,
    process.env.APPDATA && path.join(process.env.APPDATA, 'npm/node_modules/expo-cli/node_modules/sucrase')];
  for (var i = 0; i < tries.length; i++) { if (!tries[i]) continue; try { return require(tries[i]); } catch (e) {} }
  return null;
})();
if (!sucrase) {
  console.log('SKIPPED — edge-functions.test.js needs `sucrase` to read TypeScript. Set SUCRASE_PATH or `npm i -g sucrase`.');
  process.exit(0);
}

var SECRET = 'test-secret-0123456789abcdef';
var logs = [];

// ── fake database ─────────────────────────────────────────────────────
function makeDb() {
  return {
    auth_store: [{ id: 'users', data: [] }, { id: 'shops', data: [] }],
    login_attempts: [], password_reset_tokens: [], store: [], counters: {},
    seq: 1, fail: {}, rpcCalls: [],
  };
}
function Q(db, t) { this.db = db; this.t = t; this.f = []; this.op = 'select'; this.opts = {}; this.lim = null; this.ord = null; }
Q.prototype.select = function (c, o) { if (this.op === 'select') this.opts = o || {}; return this; };
Q.prototype.eq = function (c, v) { this.f.push(function (r) { return r[c] === v; }); return this; };
Q.prototype.gte = function (c, v) { this.f.push(function (r) { return r[c] >= v; }); return this; };
Q.prototype.in = function (c, vs) { this.f.push(function (r) { return vs.indexOf(r[c]) !== -1; }); return this; };
Q.prototype.order = function (c, o) { this.ord = [c, o && o.ascending]; return this; };
Q.prototype.limit = function (n) { this.lim = n; return this; };
Q.prototype.insert = function (p) { this.op = 'insert'; this.p = p; return this; };
Q.prototype.upsert = function (p) { this.op = 'upsert'; this.p = p; return this; };
Q.prototype.update = function (p) { this.op = 'update'; this.p = p; return this; };
Q.prototype.then = function (a, b) { return Promise.resolve().then(this.exec.bind(this)).then(a, b); };
Q.prototype.exec = function () {
  var db = this.db, rows = db[this.t], self = this;
  if (db.fail[this.t]) { delete db.fail[this.t]; return { data: null, error: { message: 'injected failure on ' + this.t } }; }
  var match = function () { return rows.filter(function (r) { return self.f.every(function (fn) { return fn(r); }); }); };
  if (this.op === 'insert') {
    var row = Object.assign({ id: db.seq++, created_at: new Date(Date.now() + db.seq).toISOString(), used: false, failed_attempts: 0 }, this.p);
    rows.push(row); return { data: null, error: null };
  }
  if (this.op === 'upsert') {
    var ex = rows.find(function (r) { return r.id === self.p.id; });
    if (ex) Object.assign(ex, JSON.parse(JSON.stringify(self.p))); else rows.push(JSON.parse(JSON.stringify(self.p)));
    return { data: null, error: null };
  }
  if (this.op === 'update') { match().forEach(function (r) { Object.assign(r, self.p); }); return { data: null, error: null }; }
  var out = match();
  if (this.opts.head) return { data: null, count: out.length, error: null };
  if (this.ord) { var c = this.ord[0], asc = this.ord[1]; out.sort(function (x, y) { return (x[c] < y[c] ? -1 : 1) * (asc ? 1 : -1); }); }
  if (this.lim != null) out = out.slice(0, this.lim);
  return { data: JSON.parse(JSON.stringify(out)), error: null };
};

// JS model of 003's consume_password_reset_code (the SQL itself can't run here).
function consumeModel(db, a) {
  var toks = db.password_reset_tokens.filter(function (t) { return t.email === a.p_email; })
    .sort(function (x, y) { return x.created_at < y.created_at ? 1 : x.created_at > y.created_at ? -1 : y.id - x.id; });
  var t = toks[0];
  if (!t || t.used || new Date(t.expires_at).getTime() <= Date.now()) return false;
  if (t.code_hash === a.p_code_hash) { t.used = true; return true; }
  t.used = (t.failed_attempts + 1 >= a.p_max_attempts);
  t.failed_attempts += 1;
  return false;
}

function makeClient(db) {
  return {
    from: function (t) { return new Q(db, t); },
    rpc: function (name, args) {
      db.rpcCalls.push({ name: name, args: args });
      if (db.fail['rpc:' + name]) { delete db.fail['rpc:' + name]; return Promise.resolve({ data: null, error: { message: 'injected rpc failure' } }); }
      if (name === 'consume_password_reset_code') return Promise.resolve({ data: consumeModel(db, args), error: null });
      if (name === 'store_cas_write') {
        var ex = db.store.find(function (r) { return r.id === args.p_shop_id; });
        var v = ex ? (ex.data._v || 0) : 0;
        if (v !== args.p_expected_version) return Promise.resolve({ data: [{ ok: false, conflict: true, new_data: null, current_data: ex && ex.data }], error: null });
        var nd = Object.assign({}, args.p_data, { _v: v + 1 });
        if (ex) ex.data = nd; else db.store.push({ id: args.p_shop_id, data: nd, updated_at: new Date().toISOString() });
        return Promise.resolve({ data: [{ ok: true, conflict: false, new_data: nd, current_data: null }], error: null });
      }
      if (name === 'increment_shop_counter') { var k = args.p_shop_id + '_' + args.p_counter; db.counters[k] = (db.counters[k] || 0) + 1; return Promise.resolve({ data: db.counters[k], error: null }); }
      return Promise.resolve({ data: null, error: { message: 'unknown rpc ' + name } });
    },
  };
}

// ── load a real Edge Function into a sandbox ──────────────────────────
function load(file, db) {
  var src = fs.readFileSync(file, 'utf8').replace(/^import \{ createClient \} from "jsr:[^"]+";$/m, 'const { createClient } = __mock;');
  var js = sucrase.transform(src, { transforms: ['typescript'] }).code;
  var handler = null;
  var ctx = {
    __mock: { createClient: function () { return makeClient(db); } },
    Deno: { env: { get: function (k) { return { SUPABASE_URL: 'http://fake', SUPABASE_SERVICE_ROLE_KEY: 'svc', SESSION_SECRET: SECRET }[k]; } }, serve: function (h) { handler = h; } },
    crypto: webcrypto, TextEncoder: TextEncoder, TextDecoder: TextDecoder, btoa: btoa, atob: atob,
    Response: Response, URL: URL, Uint8Array: Uint8Array, Uint32Array: Uint32Array, Array: Array, String: String, JSON: JSON, Date: Date, Math: Math, Set: Set, Promise: Promise,
    console: { log: function (m) { logs.push(String(m)); }, error: function (m, x) { logs.push('ERR ' + m + (x || '')); } },
  };
  vm.runInNewContext(js, ctx, { filename: file });
  return handler;
}

async function call(h, route, body, headers, method) {
  var req = new Request('http://fake/functions/v1/x/' + (route || ''), {
    method: method || 'POST', headers: Object.assign({ 'content-type': 'application/json' }, headers || {}),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  var res = await h(req);
  var text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

// ── tests ─────────────────────────────────────────────────────────────
var results = [];
async function test(name, fn) {
  try { await fn(); results.push(['PASS', name]); }
  catch (e) { results.push(['FAIL', name + '\n        ' + e.message]); }
}
function eq(a, b, what) { if (a !== b) throw new Error(what + ': expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }

(async function () {
  var root = path.join(__dirname, '..');
  var AG = process.argv[2] || path.join(root, 'supabase/functions/auth-gateway/index.ts');
  var SP = process.argv[3] || path.join(root, 'supabase/functions/store-proxy/index.ts');
  var db = makeDb();
  var auth = load(AG, db), proxy = load(SP, db);
  var sp = function (token, method, body) { return call(proxy, '', body, { 'x-session-token': token }, method); };
  var ver = async function () { var r = await sp(ownerTok, 'GET'); return (r.body && r.body.data && r.body.data._v) || 0; };

  var owner = await call(auth, 'signup', { name: 'Owner', email: 'owner@shop.in', password: 'ownerpass1', shopName: 'Sri Sai', city: 'Hyd' });
  var ownerTok = owner.body.sessionToken;
  var shopId = owner.body.shop.id;

  var staffAdd = await call(auth, 'add-staff', { sessionToken: ownerTok, name: 'Ravi', email: 'ravi@shop.in', role: 'staff' });
  var staffLogin = await call(auth, 'login', { email: 'ravi@shop.in', password: staffAdd.body.tempPassword });
  var staffTok = staffLogin.body.sessionToken;

  // ---- store-proxy: unchanged behaviour for legitimate users
  await test('owner can read the shop', async function () { eq((await sp(ownerTok, 'GET')).status, 200, 'status'); });
  await test('owner can save the shop', async function () {
    var r = await sp(ownerTok, 'PUT', { data: { sales: [] }, expectedVersion: 0 });
    eq(r.status, 200, 'status'); eq(r.body.data._v, 1, 'version');
  });
  await test('staff can read, save and take a counter while still employed', async function () {
    eq((await sp(staffTok, 'GET')).status, 200, 'GET');
    eq((await sp(staffTok, 'PUT', { data: { sales: [1] }, expectedVersion: await ver() })).status, 200, 'PUT');
    eq((await sp(staffTok, 'POST', { action: 'increment_counter', counter: 'inv_no' })).status, 200, 'POST');
  });
  await test('a garbage token is rejected with 401', async function () { eq((await sp('abc.def', 'GET')).status, 401, 'status'); });

  // ---- store-proxy: finding 3
  await test('a REMOVED staff member is cut off immediately (401 on read)', async function () {
    var rm = await call(auth, 'remove-staff', { sessionToken: ownerTok, staffUserId: staffLogin.body.user.id });
    eq(rm.status, 200, 'remove-staff');
    eq((await sp(staffTok, 'GET')).status, 401, 'GET after removal');
  });
  await test('a REMOVED staff member cannot save or take counters (401)', async function () {
    eq((await sp(staffTok, 'PUT', { data: { wiped: true }, expectedVersion: await ver() })).status, 401, 'PUT after removal (attempted wipe)');
    eq((await sp(staffTok, 'POST', { action: 'increment_counter', counter: 'inv_no' })).status, 401, 'POST after removal');
  });
  await test('role is taken from the current record, not the token', async function () {
    var add = await call(auth, 'add-staff', { sessionToken: ownerTok, name: 'Meena', email: 'meena@shop.in', role: 'manager' });
    var tok = (await call(auth, 'login', { email: 'meena@shop.in', password: add.body.tempPassword })).body.sessionToken;
    eq((await sp(tok, 'PUT', { data: { a: 1 }, expectedVersion: await ver() })).status, 200, 'manager PUT before downgrade');
    db.auth_store[0].data.find(function (u) { return u.email === 'meena@shop.in'; }).role = 'readonly';
    eq((await sp(tok, 'GET')).status, 200, 'readonly GET');
    eq((await sp(tok, 'PUT', { data: { a: 2 }, expectedVersion: await ver() })).status, 403, 'readonly PUT');
  });
  await test('a user whose record now points at another shop is cut off (401)', async function () {
    var add = await call(auth, 'add-staff', { sessionToken: ownerTok, name: 'Anil', email: 'anil@shop.in', role: 'staff' });
    var tok = (await call(auth, 'login', { email: 'anil@shop.in', password: add.body.tempPassword })).body.sessionToken;
    db.auth_store[0].data.find(function (u) { return u.email === 'anil@shop.in'; }).shopId = 'shop_other';
    eq((await sp(tok, 'GET')).status, 401, 'GET');
  });
  await test('the legacy non-UUID "main" rowKey is still refused (403)', async function () {
    var shop = db.auth_store[1].data.find(function (s) { return s.id === shopId; });
    var saved = shop.rowKey; shop.rowKey = 'main';
    try { eq((await sp(ownerTok, 'GET')).status, 403, 'status'); } finally { shop.rowKey = saved; }
  });
  await test('a database error during the lookup is not reported as success', async function () {
    db.fail.auth_store = true;
    var s = (await sp(ownerTok, 'GET')).status;
    if (s === 200) throw new Error('got 200 on a failed lookup');
  });

  // ---- auth-gateway reset: finding 1
  var codeFor = function (email) {
    for (var i = logs.length - 1; i >= 0; i--) { var m = logs[i].match(new RegExp('reset code for ' + email.replace('.', '\\.') + ': (\\d{6})')); if (m) return m[1]; }
    throw new Error('no code logged');
  };
  // Requests a code and fails loudly if the server didn't actually issue one
  // (request-password-reset silently stops issuing after 3 an hour).
  var newCode = async function (email) {
    var before = logs.length;
    await call(auth, 'request-password-reset', { email: email });
    if (logs.length === before) throw new Error('no new code issued for ' + email + ' (hourly request limit hit?)');
    return codeFor(email);
  };
  var wrong = function (code) { return String((parseInt(code, 10) - 100000 + 1) % 900000 + 100000); };
  var reset = function (email, code, pw) { return call(auth, 'reset-password', { email: email, code: code, newPassword: pw }); };

  await test('5 wrong guesses burn the code — the right code then fails', async function () {
    var code = await newCode('owner@shop.in');
    for (var i = 0; i < 5; i++) eq((await reset('owner@shop.in', wrong(code), 'hacked-pass-1')).status, 401, 'wrong guess ' + (i + 1));
    eq((await reset('owner@shop.in', code, 'hacked-pass-1')).status, 401, 'right code after 5 wrong');
    eq((await call(auth, 'login', { email: 'owner@shop.in', password: 'ownerpass1' })).status, 200, 'owner password unchanged');
  });
  await test('4 wrong guesses do NOT burn it — a real user who mistypes still gets in', async function () {
    var code = await newCode('owner@shop.in');
    for (var i = 0; i < 4; i++) await reset('owner@shop.in', wrong(code), 'newpass-123');
    eq((await reset('owner@shop.in', code, 'newpass-123')).status, 200, 'right code on 5th try');
    eq((await call(auth, 'login', { email: 'owner@shop.in', password: 'newpass-123' })).status, 200, 'login with new password');
  });
  await test('a used code cannot be replayed', async function () {
    var code = codeFor('owner@shop.in');
    eq((await reset('owner@shop.in', code, 'another-pass-9')).status, 401, 'replay');
  });
  await test('only the newest code works — an older one is retired', async function () {
    var older = await newCode('meena@shop.in');
    var newer = await newCode('meena@shop.in');
    if (older === newer) return; // 1-in-900k collision, nothing to test
    eq((await reset('meena@shop.in', older, 'older-code-pass')).status, 401, 'older code');
    eq((await reset('meena@shop.in', newer, 'newer-code-pass')).status, 200, 'newer code');
  });
  await test('reset-password passes the guess cap of 5 to the database', async function () {
    var c = db.rpcCalls.filter(function (x) { return x.name === 'consume_password_reset_code'; }).pop();
    if (!c) throw new Error('consume_password_reset_code was never called');
    eq(c.args.p_max_attempts, 5, 'p_max_attempts');
    eq(c.args.p_email, 'meena@shop.in', 'p_email');
  });
  await test('a database error during reset returns 500 and changes nothing', async function () {
    db.fail['rpc:consume_password_reset_code'] = true;
    eq((await reset('owner@shop.in', '123456', 'should-not-apply')).status, 500, 'status');
    eq((await call(auth, 'login', { email: 'owner@shop.in', password: 'newpass-123' })).status, 200, 'password unchanged');
  });

  // ---- unchanged routes still work
  await test('login / change-password / update-shop unchanged', async function () {
    var t = (await call(auth, 'login', { email: 'owner@shop.in', password: 'newpass-123' })).body.sessionToken;
    eq((await call(auth, 'change-password', { sessionToken: t, currentPassword: 'newpass-123', newPassword: 'final-pass-77' })).status, 200, 'change-password');
    eq((await call(auth, 'update-shop', { sessionToken: t, city: 'Vizag' })).status, 200, 'update-shop');
    eq((await call(auth, 'login', { email: 'owner@shop.in', password: 'wrong' })).status, 401, 'wrong password');
  });

  var failed = 0;
  console.log('\nJewelOS Edge Function tests\n' + '='.repeat(50));
  results.forEach(function (r) { if (r[0] === 'FAIL') failed++; console.log('  ' + (r[0] === 'PASS' ? '\u2713' : '\u2717') + ' ' + r[1]); });
  console.log('\n' + (results.length - failed) + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(function (e) { console.error('HARNESS CRASH:', e); process.exit(2); });
