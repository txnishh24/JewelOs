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
//
// Reset codes are read from the captured outbound Resend request, never from
// the logs — the log fallback that used to print them was the 17 Sep finding.
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
var sentEmails = []; // every outbound Resend call the functions made

// Every PBKDF2 the functions run, in order. Login must run exactly one per
// request whether or not the email is registered (docs/login-timing-sidechannel-design.md).
var deriveCalls = [];
var countingCrypto = {
  getRandomValues: function (a) { return webcrypto.getRandomValues(a); },
  randomUUID: function () { return webcrypto.randomUUID(); },
  subtle: new Proxy(webcrypto.subtle, {
    get: function (t, k) {
      if (k === 'deriveBits') return function (params, key, len) {
        deriveCalls.push({ name: params.name, iterations: params.iterations, hash: params.hash,
                           saltLen: params.salt && params.salt.byteLength, len: len });
        return t.deriveBits(params, key, len);
      };
      var v = t[k];
      return typeof v === 'function' ? v.bind(t) : v;
    },
  }),
};

// ── fake database ─────────────────────────────────────────────────────
function makeDb() {
  return {
    auth_store: [{ id: 'users', data: [], version: 0 }, { id: 'shops', data: [], version: 0 }],
    auth_store_history: [],
    login_attempts: [], login_throttle: [], password_reset_tokens: [], store: [], counters: {},
    seq: 1, fail: {}, rpcCalls: [],
    // One-shot: fires right before the NEXT auth_store_cas_write call, then
    // clears itself. Lets a test simulate "another write landed between the
    // gateway's read and its CAS call" by mutating db.auth_store directly.
    beforeRpc: null,
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
Q.prototype.delete = function () { this.op = 'delete'; return this; };
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
  if (this.op === 'delete') { match().forEach(function (r) { var i = rows.indexOf(r); if (i !== -1) rows.splice(i, 1); }); return { data: null, error: null }; }
  var out = match();
  if (this.opts.head) return { data: null, count: out.length, error: null };
  if (this.ord) { var c = this.ord[0], asc = this.ord[1]; out.sort(function (x, y) { return (x[c] < y[c] ? -1 : 1) * (asc ? 1 : -1); }); }
  if (this.lim != null) out = out.slice(0, this.lim);
  return { data: JSON.parse(JSON.stringify(out)), error: null };
};

// JS model of 008's auth_store_cas_write (migrations/008_auth_store_cas_history.sql;
// the SQL itself is proven separately by tests/sql-auth-store-cas.test.mjs).
function casWriteModel(db, a) {
  if (db.beforeRpc) { var hook = db.beforeRpc; db.beforeRpc = null; hook(); }
  var row = db.auth_store.find(function (r) { return r.id === a.p_id; });
  if (!row) return { ok: true, conflict: false, cur_version: 1, current_data: null };
  if (row.version !== a.p_expected_version) {
    return { ok: false, conflict: true, cur_version: row.version, current_data: JSON.parse(JSON.stringify(row.data)) };
  }
  db.auth_store_history.push({
    row_id: a.p_id, old_version: row.version, new_version: row.version + 1,
    old_data: JSON.parse(JSON.stringify(row.data)), actor: a.p_actor || null,
  });
  row.data = JSON.parse(JSON.stringify(a.p_data));
  row.version += 1;
  return { ok: true, conflict: false, cur_version: row.version, current_data: null };
}

// JS model of 009's login_throttle_take (migrations/009_login_throttle.sql;
// the SQL itself is proven separately by tests/sql-login-throttle.test.mjs).
// Proves the ROUTE's wiring and ordering against a synchronous (and
// therefore atomic) model, not Postgres's `for update` locking under real
// concurrent connections -- same limitation `consumeModel` below has.
function throttleModel(db, a) {
  var now = Date.now(), r = db.login_throttle.find(function (x) { return x.key === a.p_key; });
  if (!r) { r = { key: a.p_key, failures: 0, lockouts: 0, locked_until: null, last_attempt_at: now }; db.login_throttle.push(r); }
  if (r.locked_until && r.locked_until > now) return Math.max(1, Math.ceil((r.locked_until - now) / 1000));
  if (Math.max(r.last_attempt_at, r.locked_until || 0) <= now - a.p_max_lock_min * 60000) { r.failures = 0; r.lockouts = 0; }
  r.failures++;
  if (r.failures >= a.p_max_failures) {
    r.locked_until = now + Math.min(a.p_max_lock_min, a.p_base_lock_min * Math.pow(2, Math.min(r.lockouts, 16))) * 60000;
    r.lockouts++; r.failures = 0;
  }
  r.last_attempt_at = now;
  return 0;
}

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
      if (name === 'auth_store_cas_write') return Promise.resolve({ data: [casWriteModel(db, args)], error: null });
      if (name === 'login_throttle_take') return Promise.resolve({ data: throttleModel(db, args), error: null });
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
// `env` overrides the defaults below; pass e.g. { RESEND_API_KEY: undefined }
// to load a copy of the function as it behaves on a misconfigured project.
function load(file, db, env) {
  var src = fs.readFileSync(file, 'utf8').replace(/^import \{ createClient \} from "jsr:[^"]+";$/m, 'const { createClient } = __mock;');
  var js = sucrase.transform(src, { transforms: ['typescript'] }).code;
  var handler = null;
  var envMap = Object.assign({
    SUPABASE_URL: 'http://fake', SUPABASE_SERVICE_ROLE_KEY: 'svc', SESSION_SECRET: SECRET,
    RESEND_API_KEY: 're_test_key', RESEND_FROM_EMAIL: 'noreply@jewelos.test',
  }, env || {});
  // Stands in for Resend. Records what was sent so tests can read the code
  // from the email itself; db.fail.resend makes the next send bounce.
  var fakeFetch = function (url, opts) {
    var payload = {};
    try { payload = JSON.parse((opts && opts.body) || '{}'); } catch (e) {}
    sentEmails.push({ url: String(url), to: payload.to, text: String(payload.text || '') });
    if (db.fail.resend) {
      delete db.fail.resend;
      return Promise.resolve({ ok: false, status: 422, text: function () { return Promise.resolve('injected resend failure'); } });
    }
    return Promise.resolve({ ok: true, status: 200, text: function () { return Promise.resolve('{}'); } });
  };
  var ctx = {
    __mock: { createClient: function () { return makeClient(db); } },
    fetch: fakeFetch,
    Deno: { env: { get: function (k) { return envMap[k]; } }, serve: function (h) { handler = h; } },
    crypto: countingCrypto, TextEncoder: TextEncoder, TextDecoder: TextDecoder, btoa: btoa, atob: atob,
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
  await test('a token that fails verification says reason "expired" (sign in again, no wipe)', async function () {
    eq((await sp('abc.def', 'GET')).body.reason, 'expired', 'reason');
  });

  // ---- store-proxy: finding 3
  await test('a REMOVED staff member is cut off immediately (401 on read)', async function () {
    var rm = await call(auth, 'remove-staff', { sessionToken: ownerTok, staffUserId: staffLogin.body.user.id });
    eq(rm.status, 200, 'remove-staff');
    var r = await sp(staffTok, 'GET');
    eq(r.status, 401, 'GET after removal');
    eq(r.body.reason, 'revoked', 'a removed user is told "revoked", so the phone wipes whatever its clock says');
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
  // Read the code out of the email that was actually sent. The 15-minute TTL
  // in the same sentence is two digits, so \d{6} can only be the code.
  var codeFor = function (email) {
    for (var i = sentEmails.length - 1; i >= 0; i--) {
      if (sentEmails[i].to !== email) continue;
      var m = sentEmails[i].text.match(/\b(\d{6})\b/);
      if (m) return m[1];
    }
    throw new Error('no code emailed to ' + email);
  };
  // Requests a code and fails loudly if the server didn't actually issue one
  // (request-password-reset silently stops issuing after 3 an hour).
  var newCode = async function (email) {
    var before = sentEmails.length;
    await call(auth, 'request-password-reset', { email: email });
    if (sentEmails.length === before) throw new Error('no new code issued for ' + email + ' (hourly request limit hit?)');
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
    var relogin = await call(auth, 'login', { email: 'owner@shop.in', password: 'newpass-123' });
    eq(relogin.status, 200, 'login with new password');
    // A successful reset bumps sessionVersion (docs/session-versioning-design.md),
    // which deliberately invalidates the shared `ownerTok` minted at signup —
    // every test below this point that still needs a valid owner token must
    // use a fresh one, same as the real app would after any password reset.
    ownerTok = relogin.body.sessionToken;
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

  // ---- auth-gateway reset: the code must never reach the logs (17 Sep)
  await test('the reset code is never written to the function logs', async function () {
    var add = await call(auth, 'add-staff', { sessionToken: ownerTok, name: 'Leak', email: 'leak@shop.in', role: 'staff' });
    eq(add.status, 200, 'add-staff');
    var code = await newCode('leak@shop.in');
    var leaked = logs.filter(function (l) { return l.indexOf(code) !== -1; });
    if (leaked.length) throw new Error('reset code appeared in logs: ' + leaked.join(' | '));
    // Prove the code was real, so this can't pass by never issuing one.
    eq((await reset('leak@shop.in', code, 'leak-newpass-1')).status, 200, 'the code still works');
  });
  // THE finding: with no provider configured the old code logged the code in
  // full. Assert on the logs before anything else, so this fails for that
  // reason and not because some later expectation happened to trip first.
  await test('with no email provider configured, the code is still never logged', async function () {
    var db2 = makeDb();
    var auth2 = load(AG, db2, { RESEND_API_KEY: undefined });
    eq((await call(auth2, 'signup', { name: 'O2', email: 'o2@shop.in', password: 'ownerpass2', shopName: 'S2', city: 'C' })).status, 200, 'signup');
    var logsBefore = logs.length;
    await call(auth2, 'request-password-reset', { email: 'o2@shop.in' });
    var sixDigit = logs.slice(logsBefore).filter(function (l) { return /\b\d{6}\b/.test(l); });
    if (sixDigit.length) throw new Error('a six-digit value was logged: ' + sixDigit.join(' | '));
  });
  await test('with no email provider configured, no code is issued and the caller gets 503', async function () {
    var db2 = makeDb();
    var auth2 = load(AG, db2, { RESEND_API_KEY: undefined });
    eq((await call(auth2, 'signup', { name: 'O4', email: 'o4@shop.in', password: 'ownerpass4', shopName: 'S4', city: 'C' })).status, 200, 'signup');
    var mailsBefore = sentEmails.length;
    eq((await call(auth2, 'request-password-reset', { email: 'o4@shop.in' })).status, 503, 'status');
    eq(db2.password_reset_tokens.length, 0, 'tokens issued');
    eq(sentEmails.length, mailsBefore, 'emails sent');
  });
  await test('that 503 does not reveal whether the account exists', async function () {
    var db2 = makeDb();
    var auth2 = load(AG, db2, { RESEND_API_KEY: undefined });
    await call(auth2, 'signup', { name: 'O3', email: 'o3@shop.in', password: 'ownerpass3', shopName: 'S3', city: 'C' });
    var known = await call(auth2, 'request-password-reset', { email: 'o3@shop.in' });
    var unknown = await call(auth2, 'request-password-reset', { email: 'nobody@shop.in' });
    eq(known.status, unknown.status, 'status');
    eq(JSON.stringify(known.body), JSON.stringify(unknown.body), 'body');
  });
  await test('a code that could not be emailed is retired, not left live', async function () {
    var add = await call(auth, 'add-staff', { sessionToken: ownerTok, name: 'Bounce', email: 'bounce@shop.in', role: 'staff' });
    eq(add.status, 200, 'add-staff');
    db.fail.resend = true;
    var r = await call(auth, 'request-password-reset', { email: 'bounce@shop.in' });
    eq(r.status, 200, 'status is still the generic OK');
    eq(db.password_reset_tokens.filter(function (t) { return t.email === 'bounce@shop.in'; }).length, 0, 'tokens left behind');
  });
  // email-status is cloudDiag()'s operator-only signal for the exact gap the
  // test above locks in: a real send failure never reaches the end user by
  // design, so this is the only place that failure is visible at all. It's
  // account-independent on purpose (same info request-password-reset's own
  // 503 already leaks for free when the key is unset) -- never give this
  // route a body field that could turn it into a second enumeration path.
  await test('email-status reports configured, non-sandbox when a real provider is set', async function () {
    var r = await call(auth, 'email-status', {});
    eq(r.status, 200, 'status');
    eq(r.body.configured, true, 'configured');
    eq(r.body.sandbox, false, 'sandbox');
    eq(r.body.fromAddress, 'noreply@jewelos.test', 'fromAddress');
  });
  await test('email-status reports not configured with no RESEND_API_KEY, same fact the 503 already gives away', async function () {
    var auth2 = load(AG, makeDb(), { RESEND_API_KEY: undefined });
    var r = await call(auth2, 'email-status', {});
    eq(r.status, 200, 'status');
    eq(r.body.configured, false, 'configured');
  });
  await test('email-status flags the Resend sandbox default, which cannot deliver to real customers', async function () {
    var auth2 = load(AG, makeDb(), { RESEND_FROM_EMAIL: 'onboarding@resend.dev' });
    var r = await call(auth2, 'email-status', {});
    eq(r.body.sandbox, true, 'sandbox');
    eq(r.body.fromAddress, 'onboarding@resend.dev', 'fromAddress');
  });

  // ---- auth-gateway: no markup in names and shop details (finding 2)
  await test('update-shop refuses < or > in shop details — including from a manager — and changes nothing', async function () {
    var add = await call(auth, 'add-staff', { sessionToken: ownerTok, name: 'Kiran', email: 'kiran@shop.in', role: 'manager' });
    var mgrTok = (await call(auth, 'login', { email: 'kiran@shop.in', password: add.body.tempPassword })).body.sessionToken;
    var before = JSON.stringify(db.auth_store[1].data.find(function (s) { return s.id === shopId; }));
    var r = await call(auth, 'update-shop', { sessionToken: mgrTok, name: 'Sri Sai<img src=x onerror=alert(1)>' });
    eq(r.status, 400, 'status');
    eq(JSON.stringify(db.auth_store[1].data.find(function (s) { return s.id === shopId; })), before, 'shop record');
    for (var f of ['city', 'phone', 'gstin']) {
      var body = { sessionToken: mgrTok }; body[f] = 'x>y';
      eq((await call(auth, 'update-shop', body)).status, 400, f);
    }
  });
  await test('update-shop still accepts real shop names with & and apostrophes', async function () {
    var r = await call(auth, 'update-shop', { sessionToken: ownerTok, name: "Sri Sai & Sons' Jewellers", city: 'Vijayawada' });
    eq(r.status, 200, 'status');
    eq(r.body.shop.name, "Sri Sai & Sons' Jewellers", 'saved name');
  });
  await test('signup and add-staff refuse < or > in names', async function () {
    eq((await call(auth, 'signup', { name: 'A', email: 'a1@x.in', password: 'longenough1', shopName: '<b>Shop</b>', city: 'X' })).status, 400, 'signup shopName');
    eq((await call(auth, 'signup', { name: '<i>A</i>', email: 'a2@x.in', password: 'longenough1', shopName: 'Shop', city: 'X' })).status, 400, 'signup name');
    eq((await call(auth, 'add-staff', { sessionToken: ownerTok, name: 'Ra<vi', email: 'r2@shop.in', role: 'staff' })).status, 400, 'add-staff name');
    var users = db.auth_store[0].data.map(function (u) { return u.email; });
    if (users.indexOf('a1@x.in') !== -1 || users.indexOf('a2@x.in') !== -1 || users.indexOf('r2@shop.in') !== -1) throw new Error('a refused account was still created');
  });

  // ---- auth-gateway: Phase 3 critical remediation (10 Oct) — update-shop/
  // add-staff/remove-staff used to trust session.role (a snapshot baked into
  // the token at login, live up to 6h) instead of the caller's CURRENT
  // record, so a demoted or removed user kept the old permissions until
  // their token expired. Each test below that demotes/removes/expires an
  // OWNER signs up its own fresh shop, so the shared ownerTok/shopId used by
  // tests elsewhere in this file is never touched.
  var mint = function (p) {
    var b = Buffer.from(JSON.stringify(p)).toString('base64url');
    return b + '.' + require('crypto').createHmac('sha256', SECRET).update(b).digest('base64url');
  };
  var freshShop = async function (tag) {
    var s = await call(auth, 'signup', { name: 'Owner ' + tag, email: 'owner-' + tag + '@shop.in', password: 'ownerpass1', shopName: 'Shop ' + tag, city: 'City' });
    return { tok: s.body.sessionToken, shopId: s.body.shop.id, userId: s.body.user.id };
  };

  await test('update-shop: a manager still on the team can update shop details (200)', async function () {
    var o = await freshShop('m1');
    var add = await call(auth, 'add-staff', { sessionToken: o.tok, name: 'Mgr', email: 'mgr-m1@shop.in', role: 'manager' });
    var mgrTok = (await call(auth, 'login', { email: 'mgr-m1@shop.in', password: add.body.tempPassword })).body.sessionToken;
    eq((await call(auth, 'update-shop', { sessionToken: mgrTok, city: 'Pune' })).status, 200, 'status');
  });
  await test('update-shop: a manager demoted to staff after login is refused (403) and the shop is unchanged', async function () {
    var o = await freshShop('m2');
    var add = await call(auth, 'add-staff', { sessionToken: o.tok, name: 'Mgr', email: 'mgr-m2@shop.in', role: 'manager' });
    var mgrTok = (await call(auth, 'login', { email: 'mgr-m2@shop.in', password: add.body.tempPassword })).body.sessionToken;
    var before = JSON.stringify(db.auth_store[1].data.find(function (s) { return s.id === o.shopId; }));
    db.auth_store[0].data.find(function (u) { return u.email === 'mgr-m2@shop.in'; }).role = 'staff';
    eq((await call(auth, 'update-shop', { sessionToken: mgrTok, city: 'Pune' })).status, 403, 'status');
    eq(JSON.stringify(db.auth_store[1].data.find(function (s) { return s.id === o.shopId; })), before, 'shop record');
  });
  await test('update-shop: a manager REMOVED after login is refused (401) and the shop is unchanged', async function () {
    var o = await freshShop('m3');
    var add = await call(auth, 'add-staff', { sessionToken: o.tok, name: 'Mgr', email: 'mgr-m3@shop.in', role: 'manager' });
    var mgrLogin = await call(auth, 'login', { email: 'mgr-m3@shop.in', password: add.body.tempPassword });
    var mgrTok = mgrLogin.body.sessionToken;
    var before = JSON.stringify(db.auth_store[1].data.find(function (s) { return s.id === o.shopId; }));
    eq((await call(auth, 'remove-staff', { sessionToken: o.tok, staffUserId: mgrLogin.body.user.id })).status, 200, 'remove-staff');
    var r = await call(auth, 'update-shop', { sessionToken: mgrTok, city: 'Pune' });
    eq(r.status, 401, 'status');
    eq(r.body.error, 'Your access to this shop has changed — please sign in again', 'error message');
    eq(JSON.stringify(db.auth_store[1].data.find(function (s) { return s.id === o.shopId; })), before, 'shop record');
  });
  await test('update-shop: a manager whose record now points at another shop is refused (401) and the shop is unchanged', async function () {
    var o = await freshShop('m4');
    var add = await call(auth, 'add-staff', { sessionToken: o.tok, name: 'Mgr', email: 'mgr-m4@shop.in', role: 'manager' });
    var mgrTok = (await call(auth, 'login', { email: 'mgr-m4@shop.in', password: add.body.tempPassword })).body.sessionToken;
    var before = JSON.stringify(db.auth_store[1].data.find(function (s) { return s.id === o.shopId; }));
    db.auth_store[0].data.find(function (u) { return u.email === 'mgr-m4@shop.in'; }).shopId = 'shop_other';
    eq((await call(auth, 'update-shop', { sessionToken: mgrTok, city: 'Pune' })).status, 401, 'status');
    eq(JSON.stringify(db.auth_store[1].data.find(function (s) { return s.id === o.shopId; })), before, 'shop record');
  });
  await test('update-shop: a staff token is refused (403)', async function () {
    var o = await freshShop('m5');
    var add = await call(auth, 'add-staff', { sessionToken: o.tok, name: 'Staff', email: 'staff-m5@shop.in', role: 'staff' });
    var tok = (await call(auth, 'login', { email: 'staff-m5@shop.in', password: add.body.tempPassword })).body.sessionToken;
    eq((await call(auth, 'update-shop', { sessionToken: tok, city: 'Pune' })).status, 403, 'status');
  });

  await test('add-staff: an owner demoted after login cannot add staff (403) and no user is created', async function () {
    var o = await freshShop('a1');
    db.auth_store[0].data.find(function (u) { return u.id === o.userId; }).role = 'manager';
    var r = await call(auth, 'add-staff', { sessionToken: o.tok, name: 'New', email: 'new-a1@shop.in', role: 'staff' });
    eq(r.status, 403, 'status');
    eq(db.auth_store[0].data.some(function (u) { return u.email === 'new-a1@shop.in'; }), false, 'user created');
  });
  await test('add-staff: an owner whose user record is gone cannot add staff (401) and no user is created', async function () {
    var o = await freshShop('a2');
    db.auth_store[0].data = db.auth_store[0].data.filter(function (u) { return u.id !== o.userId; });
    var r = await call(auth, 'add-staff', { sessionToken: o.tok, name: 'New', email: 'new-a2@shop.in', role: 'staff' });
    eq(r.status, 401, 'status');
    eq(db.auth_store[0].data.some(function (u) { return u.email === 'new-a2@shop.in'; }), false, 'user created');
  });
  await test('add-staff: a current owner can still add staff (200), and re-adding the same email still returns 409', async function () {
    var o = await freshShop('a3');
    eq((await call(auth, 'add-staff', { sessionToken: o.tok, name: 'New', email: 'new-a3@shop.in', role: 'staff' })).status, 200, 'status');
    eq((await call(auth, 'add-staff', { sessionToken: o.tok, name: 'New2', email: 'new-a3@shop.in', role: 'staff' })).status, 409, 'duplicate');
  });

  await test('remove-staff: an owner demoted after login cannot remove staff (403) and the target is still present', async function () {
    var o = await freshShop('r1');
    var add = await call(auth, 'add-staff', { sessionToken: o.tok, name: 'Staff', email: 'staff-r1@shop.in', role: 'staff' });
    var staffId = add.body.user.id;
    db.auth_store[0].data.find(function (u) { return u.id === o.userId; }).role = 'manager';
    eq((await call(auth, 'remove-staff', { sessionToken: o.tok, staffUserId: staffId })).status, 403, 'status');
    eq(db.auth_store[0].data.some(function (u) { return u.id === staffId; }), true, 'target still present');
  });
  await test('remove-staff: an owner whose record is gone cannot remove staff (401) and the target is still present', async function () {
    var o = await freshShop('r2');
    var add = await call(auth, 'add-staff', { sessionToken: o.tok, name: 'Staff', email: 'staff-r2@shop.in', role: 'staff' });
    var staffId = add.body.user.id;
    db.auth_store[0].data = db.auth_store[0].data.filter(function (u) { return u.id !== o.userId; });
    eq((await call(auth, 'remove-staff', { sessionToken: o.tok, staffUserId: staffId })).status, 401, 'status');
    eq(db.auth_store[0].data.some(function (u) { return u.id === staffId; }), true, 'target still present');
  });
  await test('remove-staff: the owner still cannot remove themselves (400)', async function () {
    var o = await freshShop('r3');
    eq((await call(auth, 'remove-staff', { sessionToken: o.tok, staffUserId: o.userId })).status, 400, 'status');
  });
  await test('remove-staff: the owner still cannot remove a user from another shop (403)', async function () {
    var o1 = await freshShop('r4a');
    var o2 = await freshShop('r4b');
    var add = await call(auth, 'add-staff', { sessionToken: o2.tok, name: 'Staff', email: 'staff-r4b@shop.in', role: 'staff' });
    eq((await call(auth, 'remove-staff', { sessionToken: o1.tok, staffUserId: add.body.user.id })).status, 403, 'status');
  });
  await test('remove-staff: a current owner can still remove staff (200) and the user is gone', async function () {
    var o = await freshShop('r5');
    var add = await call(auth, 'add-staff', { sessionToken: o.tok, name: 'Staff', email: 'staff-r5@shop.in', role: 'staff' });
    var staffId = add.body.user.id;
    eq((await call(auth, 'remove-staff', { sessionToken: o.tok, staffUserId: staffId })).status, 200, 'status');
    eq(db.auth_store[0].data.some(function (u) { return u.id === staffId; }), false, 'user still present');
  });

  await test('update-shop / add-staff / remove-staff: an expired token is refused (401 "Session expired")', async function () {
    var o = await freshShop('e1');
    var expired = mint({ userId: o.userId, shopId: o.shopId, role: 'owner', exp: Date.now() - 1000 });
    eq((await call(auth, 'update-shop', { sessionToken: expired, city: 'X' })).status, 401, 'update-shop');
    eq((await call(auth, 'add-staff', { sessionToken: expired, name: 'X', email: 'x-e1@shop.in' })).status, 401, 'add-staff');
    eq((await call(auth, 'remove-staff', { sessionToken: expired, staffUserId: o.userId })).status, 401, 'remove-staff');
  });
  await test('update-shop / add-staff / remove-staff: a tampered token is refused (401)', async function () {
    var o = await freshShop('e2');
    // Flip the character right after the "." (the first real bits of the
    // HMAC), not the token's last character -- that one is base64url's
    // final 6-bit group for a 32-byte digest, which only uses its top 4
    // bits; the bottom 2 are padding, so about 1 in 16 "tampered" last
    // characters decode to the exact same bytes and the test flakes.
    var dot = o.tok.indexOf('.');
    var flip = function (c) { return c === 'a' ? 'b' : 'a'; };
    var tampered = o.tok.slice(0, dot + 1) + flip(o.tok[dot + 1]) + o.tok.slice(dot + 2);
    eq((await call(auth, 'update-shop', { sessionToken: tampered, city: 'X' })).status, 401, 'update-shop');
    eq((await call(auth, 'add-staff', { sessionToken: tampered, name: 'X', email: 'x-e2@shop.in' })).status, 401, 'add-staff');
    eq((await call(auth, 'remove-staff', { sessionToken: tampered, staffUserId: o.userId })).status, 401, 'remove-staff');
  });
  await test('update-shop / add-staff / remove-staff: a database error during the caller lookup never succeeds and changes nothing', async function () {
    var o = await freshShop('e3');
    var shopBefore = JSON.stringify(db.auth_store[1].data.find(function (s) { return s.id === o.shopId; }));
    var usersBefore = JSON.stringify(db.auth_store[0].data);

    db.fail.auth_store = true;
    var r1 = null; try { r1 = await call(auth, 'update-shop', { sessionToken: o.tok, city: 'X' }); } catch (e) {}
    if (r1 && r1.status === 200) throw new Error('update-shop got 200 on a failed lookup');
    eq(JSON.stringify(db.auth_store[1].data.find(function (s) { return s.id === o.shopId; })), shopBefore, 'shop unchanged');

    db.fail.auth_store = true;
    var r2 = null; try { r2 = await call(auth, 'add-staff', { sessionToken: o.tok, name: 'X', email: 'x-e3@shop.in' }); } catch (e) {}
    if (r2 && r2.status === 200) throw new Error('add-staff got 200 on a failed lookup');
    eq(JSON.stringify(db.auth_store[0].data), usersBefore, 'users unchanged');

    db.fail.auth_store = true;
    var r3 = null; try { r3 = await call(auth, 'remove-staff', { sessionToken: o.tok, staffUserId: o.userId }); } catch (e) {}
    if (r3 && r3.status === 200) throw new Error('remove-staff got 200 on a failed lookup');
    eq(JSON.stringify(db.auth_store[0].data), usersBefore, 'users unchanged');
  });

  // ---- auth-gateway: login timing side-channel (Phase 5 item 3)
  var pbkdf2During = async function (fn) {
    var before = deriveCalls.length; var r = await fn();
    return { r: r, calls: deriveCalls.slice(before) };
  };

  await test('login: an unknown email runs exactly one PBKDF2, the same as a wrong password for a real account', async function () {
    await freshShop('t1');
    var real = await pbkdf2During(function () { return call(auth, 'login', { email: 'owner-t1@shop.in', password: 'wrong-pass-1' }); });
    var none = await pbkdf2During(function () { return call(auth, 'login', { email: 'nobody-t1@shop.in', password: 'wrong-pass-1' }); });
    eq(real.calls.length, 1, 'real account, wrong password: PBKDF2 calls');
    eq(none.calls.length, 1, 'unknown email: PBKDF2 calls');            // 0 on today's code: this is the bug
    eq(JSON.stringify(none.calls[0]), JSON.stringify(real.calls[0]), 'same PBKDF2 parameters on both paths');
  });

  await test('login: an unknown email gets the identical 401 status and body as a wrong password', async function () {
    await freshShop('t2');
    var real = await call(auth, 'login', { email: 'owner-t2@shop.in', password: 'wrong-pass-2' });
    var none = await call(auth, 'login', { email: 'nobody-t2@shop.in', password: 'wrong-pass-2' });
    eq(real.status, 401, 'real status'); eq(none.status, 401, 'unknown status');
    eq(JSON.stringify(none.body), JSON.stringify(real.body), 'body');
  });

  await test('login: an unknown email never logs in, and its attempt is recorded as failed', async function () {
    var r = await call(auth, 'login', { email: 'nobody-t3@shop.in', password: 'anything-at-all' });
    eq(r.status, 401, 'status'); eq(r.body.sessionToken, undefined, 'no token');
    var rows = db.login_attempts.filter(function (a) { return a.email === 'nobody-t3@shop.in'; });
    eq(rows.length, 1, 'attempt recorded'); eq(rows[0].succeeded, false, 'succeeded');
  });

  await test('login: the correct password still succeeds with exactly one PBKDF2', async function () {
    await freshShop('t4');
    var ok = await pbkdf2During(function () { return call(auth, 'login', { email: 'owner-t4@shop.in', password: 'ownerpass1' }); });
    eq(ok.r.status, 200, 'status'); eq(ok.calls.length, 1, 'PBKDF2 calls');
  });

  // ---- auth_store CAS + history (Phase 5 items 7+8, migrations/008)
  await test('add-staff: a cross-shop race retries and both writes survive', async function () {
    var o = await freshShop('cas1');
    var before = db.rpcCalls.length;
    // Simulates an UNRELATED shop's write landing between this request's
    // read and its CAS call — exactly the item-7 race (one shared `users`
    // array for the whole platform).
    db.beforeRpc = function () {
      var row = db.auth_store.find(function (r) { return r.id === 'users'; });
      row.data = row.data.concat([{ id: 'other-shop-user', email: 'other@other.in', shopId: 'shop_other_cas1' }]);
      row.version += 1;
    };
    var r = await call(auth, 'add-staff', { sessionToken: o.tok, name: 'New', email: 'new-cas1@shop.in', role: 'staff' });
    eq(r.status, 200, 'status (retried, not failed, on an unrelated conflict)');
    var ids = db.auth_store.find(function (row) { return row.id === 'users'; }).data.map(function (u) { return u.id; });
    eq(ids.indexOf('other-shop-user') !== -1, true, 'the unrelated write survived');
    eq(ids.indexOf(r.body.user.id) !== -1, true, 'this request\'s new staff member also survived');
    var casCalls = db.rpcCalls.slice(before).filter(function (c) { return c.name === 'auth_store_cas_write'; });
    eq(casCalls.length, 2, 'exactly one retry happened (2 CAS calls: the conflict, then the successful re-apply)');
  });

  await test('remove-staff: a role change mid-request is re-checked on retry, not just at the start', async function () {
    var o = await freshShop('cas2');
    var add = await call(auth, 'add-staff', { sessionToken: o.tok, name: 'Staff', email: 'staff-cas2@shop.in', role: 'staff' });
    var staffId = add.body.user.id;
    db.beforeRpc = function () {
      var row = db.auth_store.find(function (r) { return r.id === 'users'; });
      row.data.find(function (u) { return u.id === o.userId; }).role = 'staff'; // demoted mid-flight
      row.version += 1;
    };
    var r = await call(auth, 'remove-staff', { sessionToken: o.tok, staffUserId: staffId });
    eq(r.status, 403, 'status (re-checked the actor\'s role on the retry, found it changed)');
    var stillThere = db.auth_store.find(function (row) { return row.id === 'users'; }).data.some(function (u) { return u.id === staffId; });
    eq(stillThere, true, 'the target staff member is still present — the write never landed');
  });

  await test('change-password: a password changed elsewhere mid-request is detected, not silently overwritten', async function () {
    var o = await freshShop('cas3');
    var loginTok = (await call(auth, 'login', { email: 'owner-cas3@shop.in', password: 'ownerpass1' })).body.sessionToken;
    var hookHash = 'pbkdf2:' + 'f'.repeat(64);
    db.beforeRpc = function () {
      var row = db.auth_store.find(function (r) { return r.id === 'users'; });
      var u = row.data.find(function (x) { return x.id === o.userId; });
      u.passwordHash = hookHash; u.salt = 'hook-salt-aaaaaaaaaaaaaaaaaaaaaaaa';
      row.version += 1;
    };
    var r = await call(auth, 'change-password', { sessionToken: loginTok, currentPassword: 'ownerpass1', newPassword: 'brand-new-pass-1' });
    eq(r.status, 409, 'status (the stored hash moved out from under this request)');
    var liveHash = db.auth_store.find(function (row) { return row.id === 'users'; }).data.find(function (u) { return u.id === o.userId; }).passwordHash;
    eq(liveHash, hookHash, 'the hash is left exactly as the concurrent change set it, not overwritten by the loser');
  });

  await test('add-staff: an RPC failure never succeeds and changes nothing', async function () {
    var o = await freshShop('cas4');
    var usersBefore = JSON.stringify(db.auth_store.find(function (row) { return row.id === 'users'; }).data);
    db.fail['rpc:auth_store_cas_write'] = true;
    var r = null;
    try { r = await call(auth, 'add-staff', { sessionToken: o.tok, name: 'New', email: 'new-cas4@shop.in', role: 'staff' }); } catch (e) {}
    if (r && r.status === 200) throw new Error('add-staff got 200 on an injected RPC failure');
    eq(JSON.stringify(db.auth_store.find(function (row) { return row.id === 'users'; }).data), usersBefore, 'users unchanged');
  });

  // ---- auth-gateway: login lockout race + IP-less lockout (Phase 5 item 6)
  var decodeTokenPayload = function (tok) {
    return JSON.parse(Buffer.from(tok.split('.')[0], 'base64url').toString());
  };

  await test('login: 10 parallel wrong-password guesses are capped at exactly 5 checked, not all 10 (bug A, the race)', async function () {
    var o = await freshShop('lo1');
    var results = await Promise.all(Array.from({ length: 10 }, function () {
      return call(auth, 'login', { email: 'owner-lo1@shop.in', password: 'wrong-guess' });
    }));
    var count401 = results.filter(function (r) { return r.status === 401; }).length;
    var count429 = results.filter(function (r) { return r.status === 429; }).length;
    eq(count401, 5, '401s (checked attempts)');       // 10 on today's (pre-throttle) code: this is the bug
    eq(count429, 5, '429s (refused, uncounted)');
    var rows = db.login_attempts.filter(function (a) { return a.email === 'owner-lo1@shop.in'; });
    eq(rows.length, 5, 'exactly 5 login_attempts rows — the refused ones never reached the password check');
    var r = await call(auth, 'login', { email: 'owner-lo1@shop.in', password: 'ownerpass1' });
    eq(r.status, 429, 'the right password is ALSO refused while locked — the lock does not peek at correctness');
  });

  await test('login: a different IP on the locked email still gets 429 (no IP component in the key)', async function () {
    await freshShop('lo2');
    for (var i = 0; i < 5; i++) await call(auth, 'login', { email: 'owner-lo2@shop.in', password: 'wrong' });
    var r = await call(auth, 'login', { email: 'owner-lo2@shop.in', password: 'ownerpass1' }, { 'x-forwarded-for': '203.0.113.9' });
    eq(r.status, 429, 'status');
  });

  await test('login: the owner\'s own device is immune to a lock on their email (bug B)', async function () {
    var signup = await call(auth, 'signup', { name: 'Owner', email: 'owner-lo3@shop.in', password: 'ownerpass1', shopName: 'Shop lo3', city: 'City' });
    var devTok = signup.body.deviceToken;
    for (var i = 0; i < 5; i++) await call(auth, 'login', { email: 'owner-lo3@shop.in', password: 'wrong' });
    var lockedRowBefore = db.login_throttle.find(function (r) { return r.key === 'e:owner-lo3@shop.in'; });
    var r = await call(auth, 'login', { email: 'owner-lo3@shop.in', password: 'ownerpass1', deviceToken: devTok });
    eq(r.status, 200, 'status — the device bucket is separate, so the e: lock does not apply to it');
    eq(decodeTokenPayload(r.body.deviceToken).did, decodeTokenPayload(devTok).did, 'the returned device token keeps the same device id');
    var lockedRowAfter = db.login_throttle.find(function (r) { return r.key === 'e:owner-lo3@shop.in'; });
    eq(lockedRowAfter.locked_until, lockedRowBefore.locked_until, 'the e: key is still locked, unchanged — a device sign-in never clears the attacker\'s bucket');
  });

  await test('login: a device token issued for a DIFFERENT email is not a bypass', async function () {
    var other = await call(auth, 'signup', { name: 'Other', email: 'other-lo4@shop.in', password: 'otherpass1', shopName: 'Shop other-lo4', city: 'City' });
    await freshShop('lo4');
    for (var i = 0; i < 5; i++) await call(auth, 'login', { email: 'owner-lo4@shop.in', password: 'wrong' });
    var r = await call(auth, 'login', { email: 'owner-lo4@shop.in', password: 'ownerpass1', deviceToken: other.body.deviceToken });
    eq(r.status, 429, 'a device token minted for a different email gives no bucket on this one');
  });

  await test('login: no token-type confusion between device tokens and session tokens', async function () {
    var signup = await call(auth, 'signup', { name: 'Owner', email: 'owner-lo5@shop.in', password: 'ownerpass1', shopName: 'Shop lo5', city: 'City' });
    var devTok = signup.body.deviceToken, sessTok = signup.body.sessionToken;
    for (var i = 0; i < 5; i++) await call(auth, 'login', { email: 'owner-lo5@shop.in', password: 'wrong' });
    var a = await call(auth, 'login', { email: 'owner-lo5@shop.in', password: 'ownerpass1', deviceToken: sessTok });
    eq(a.status, 429, 'a session token presented as a deviceToken on the locked email is not accepted (still locked)');
    var b = await sp(devTok, 'GET');
    eq(b.status, 401, 'a device token presented to store-proxy as a session token is rejected');
    var c = await call(auth, 'change-password', { sessionToken: devTok, currentPassword: 'ownerpass1', newPassword: 'irrelevant1' });
    eq(c.status, 401, 'a device token presented as a sessionToken to change-password is rejected');
  });

  await test('login: a garbage deviceToken never crashes the route, it just falls back to the e: key', async function () {
    await freshShop('lo6');
    var garbage = ['abc', 'a.b.c', '!!!.###'];
    for (var i = 0; i < garbage.length; i++) {
      var r = await call(auth, 'login', { email: 'owner-lo6@shop.in', password: 'wrong', deviceToken: garbage[i] });
      eq(r.status, 401, 'garbage deviceToken ' + JSON.stringify(garbage[i]) + ' still gets a normal 401, not a 500');
    }
  });

  await test('login: a successful sign-in resets the counter for that key', async function () {
    await freshShop('lo7');
    for (var i = 0; i < 4; i++) eq((await call(auth, 'login', { email: 'owner-lo7@shop.in', password: 'wrong' })).status, 401, 'wrong #' + (i + 1));
    eq((await call(auth, 'login', { email: 'owner-lo7@shop.in', password: 'ownerpass1' })).status, 200, 'the success');
    for (var j = 0; j < 5; j++) eq((await call(auth, 'login', { email: 'owner-lo7@shop.in', password: 'wrong' })).status, 401, 'post-reset wrong #' + (j + 1));
    eq((await call(auth, 'login', { email: 'owner-lo7@shop.in', password: 'wrong' })).status, 429, 'the 6th after reset is locked');
  });

  await test('login: the 5th attempt is still evaluated (it might be the right password), and a success leaves no row', async function () {
    await freshShop('lo8');
    for (var i = 0; i < 4; i++) await call(auth, 'login', { email: 'owner-lo8@shop.in', password: 'wrong' });
    var r = await call(auth, 'login', { email: 'owner-lo8@shop.in', password: 'ownerpass1' });
    eq(r.status, 200, 'the 5th counted attempt, with the right password, succeeds');
    eq(db.login_throttle.some(function (row) { return row.key === 'e:owner-lo8@shop.in'; }), false, 'the row is gone after the success-clear');
  });

  await test('login: escalation — a second lock in a row is longer than the first', async function () {
    await freshShop('lo9');
    for (var i = 0; i < 5; i++) await call(auth, 'login', { email: 'owner-lo9@shop.in', password: 'wrong' });
    var row = db.login_throttle.find(function (r) { return r.key === 'e:owner-lo9@shop.in'; });
    row.locked_until = Date.now() - 1; // force the lock to have already expired
    for (var j = 0; j < 5; j++) await call(auth, 'login', { email: 'owner-lo9@shop.in', password: 'wrong' });
    var r6 = await call(auth, 'login', { email: 'owner-lo9@shop.in', password: 'wrong' });
    eq(r6.status, 429, 'status');
    var ok = r6.body.retryAfterSec > 1740 && r6.body.retryAfterSec <= 1800;
    if (!ok) throw new Error('retryAfterSec: expected ~1741-1800 (the second, 30-minute lock), got ' + r6.body.retryAfterSec);
  });

  await test('login: an RPC failure fails closed (503) and never reaches the password check', async function () {
    await freshShop('lo10');
    var before = db.login_attempts.filter(function (a) { return a.email === 'owner-lo10@shop.in'; }).length;
    db.fail['rpc:login_throttle_take'] = true;
    var r = await call(auth, 'login', { email: 'owner-lo10@shop.in', password: 'ownerpass1' });
    eq(r.status, 503, 'status');
    var after = db.login_attempts.filter(function (a) { return a.email === 'owner-lo10@shop.in'; }).length;
    eq(after, before, 'no login_attempts row was added — the password was never checked');
  });

  await test('signup and a successful reset-password both issue a usable device token', async function () {
    var signup = await call(auth, 'signup', { name: 'Owner', email: 'owner-lo11@shop.in', password: 'ownerpass1', shopName: 'Shop lo11', city: 'City' });
    eq(typeof signup.body.deviceToken, 'string', 'signup returns a deviceToken');
    for (var i = 0; i < 5; i++) await call(auth, 'login', { email: 'owner-lo11@shop.in', password: 'wrong' });
    var r = await call(auth, 'login', { email: 'owner-lo11@shop.in', password: 'ownerpass1', deviceToken: signup.body.deviceToken });
    eq(r.status, 200, 'the signup-issued device token is immediately usable to bypass the e: lock');

    var code = await newCode('owner-lo11@shop.in');
    var resetRes = await reset('owner-lo11@shop.in', code, 'brand-new-pass-2');
    eq(typeof resetRes.body.deviceToken, 'string', 'a successful reset-password also returns a deviceToken');
    for (var j = 0; j < 5; j++) await call(auth, 'login', { email: 'owner-lo11@shop.in', password: 'wrong' });
    var r2 = await call(auth, 'login', { email: 'owner-lo11@shop.in', password: 'brand-new-pass-2', deviceToken: resetRes.body.deviceToken });
    eq(r2.status, 200, 'the reset-password-issued device token is also immediately usable to bypass the e: lock');
  });

  // ---- session versioning: a password change signs out every OTHER device (Phase 5 item 5)
  await test('zero-logout guarantee: a hand-minted legacy token (no sessionVersion) still works, for a user record that also has none', async function () {
    var o = await freshShop('sv1');
    var legacy = mint({ userId: o.userId, shopId: o.shopId, role: 'owner', exp: Date.now() + 3600000 }); // no sessionVersion field at all
    eq((await sp(legacy, 'GET')).status, 200, 'store-proxy GET');
    eq((await sp(legacy, 'PUT', { data: { a: 1 }, expectedVersion: 0 })).status, 200, 'store-proxy PUT'); // fresh shop's first save, not ownerTok's shop
    eq((await call(auth, 'update-shop', { sessionToken: legacy, city: 'Pre-deploy City' })).status, 200, 'update-shop');
  });

  await test('a legacy token dies the moment the password is changed on a DIFFERENT token', async function () {
    var o = await freshShop('sv2');
    var legacy = mint({ userId: o.userId, shopId: o.shopId, role: 'owner', exp: Date.now() + 3600000 });
    eq((await sp(legacy, 'GET')).status, 200, 'legacy token works before any change');
    var fresh = (await call(auth, 'login', { email: 'owner-sv2@shop.in', password: 'ownerpass1' })).body.sessionToken;
    eq((await call(auth, 'change-password', { sessionToken: fresh, currentPassword: 'ownerpass1', newPassword: 'sv2-new-pass-1' })).status, 200, 'change-password');
    var r = await sp(legacy, 'GET');
    eq(r.status, 401, 'legacy token now rejected');
    eq(r.body.reason, 'expired', 'reason is "expired", never "revoked" — this is not a removed user, just a stale one');
    eq((await call(auth, 'add-staff', { sessionToken: legacy, name: 'X', email: 'x-sv2@shop.in' })).status, 401, 'auth-gateway side (loadActor) also rejects it');
  });

  await test('two devices: changing the password on one signs the OTHER out, and the changer gets a fresh token that works immediately', async function () {
    var o = await freshShop('sv3');
    var t1 = (await call(auth, 'login', { email: 'owner-sv3@shop.in', password: 'ownerpass1' })).body.sessionToken;
    var t2 = (await call(auth, 'login', { email: 'owner-sv3@shop.in', password: 'ownerpass1' })).body.sessionToken;
    var changed = await call(auth, 'change-password', { sessionToken: t1, currentPassword: 'ownerpass1', newPassword: 'sv3-new-pass-1' });
    eq(changed.status, 200, 'change-password via t1');
    var t1prime = changed.body.sessionToken;
    eq((await sp(t2, 'GET')).status, 401, 't2 (the other device) is signed out');
    eq((await sp(t1, 'GET')).status, 401, 'the OLD t1 itself is also dead — only the NEW token from change-password works');
    eq((await sp(t1prime, 'GET')).status, 200, "t1' GET");
    eq((await sp(t1prime, 'PUT', { data: { x: 1 }, expectedVersion: 0 })).status, 200, "t1' PUT"); // this shop's first save, not ownerTok's shop
    eq((await call(auth, 'update-shop', { sessionToken: t1prime, city: 'Pune' })).status, 200, "t1' update-shop");
  });

  await test('a token minted after the change works, and its sessionVersion matches the record', async function () {
    var o = await freshShop('sv4');
    await call(auth, 'change-password', {
      sessionToken: (await call(auth, 'login', { email: 'owner-sv4@shop.in', password: 'ownerpass1' })).body.sessionToken,
      currentPassword: 'ownerpass1', newPassword: 'sv4-new-pass-1',
    });
    var fresh = await call(auth, 'login', { email: 'owner-sv4@shop.in', password: 'sv4-new-pass-1' });
    eq(fresh.status, 200, 'login with the new password');
    eq((await sp(fresh.body.sessionToken, 'GET')).status, 200, 'the new token works on store-proxy');
    eq(decodeTokenPayload(fresh.body.sessionToken).sessionVersion, 1, "the token's sessionVersion is 1, matching the one bump so far");
  });

  await test('reset-password bumps the version too: a pre-reset token dies, login after the reset works', async function () {
    var o = await freshShop('sv5');
    var preReset = (await call(auth, 'login', { email: 'owner-sv5@shop.in', password: 'ownerpass1' })).body.sessionToken;
    var code = await newCode('owner-sv5@shop.in');
    eq((await reset('owner-sv5@shop.in', code, 'sv5-reset-pass-1')).status, 200, 'reset succeeds');
    eq((await sp(preReset, 'GET')).status, 401, 'the pre-reset token is dead');
    eq((await call(auth, 'login', { email: 'owner-sv5@shop.in', password: 'sv5-reset-pass-1' })).status, 200, 'login with the reset password works');
  });

  await test('a stale token cannot be used to change the password again, and the hash is left unchanged', async function () {
    var o = await freshShop('sv6');
    var t1 = (await call(auth, 'login', { email: 'owner-sv6@shop.in', password: 'ownerpass1' })).body.sessionToken;
    var t2 = (await call(auth, 'login', { email: 'owner-sv6@shop.in', password: 'ownerpass1' })).body.sessionToken;
    await call(auth, 'change-password', { sessionToken: t1, currentPassword: 'ownerpass1', newPassword: 'sv6-new-pass-1' });
    var r = await call(auth, 'change-password', { sessionToken: t2, currentPassword: 'ownerpass1', newPassword: 'attacker-pass-1' });
    eq(r.status, 401, "a stale token's change-password attempt is refused");
    eq((await call(auth, 'login', { email: 'owner-sv6@shop.in', password: 'attacker-pass-1' })).status, 401, "the attacker's new password was never set");
    eq((await call(auth, 'login', { email: 'owner-sv6@shop.in', password: 'sv6-new-pass-1' })).status, 200, 'the real new password still works');
  });

  await test('staff-list edits do not bump the owner — a second token the owner holds keeps working across add-staff/remove-staff/update-shop', async function () {
    var o = await freshShop('sv7');
    var tokA = (await call(auth, 'login', { email: 'owner-sv7@shop.in', password: 'ownerpass1' })).body.sessionToken;
    var tokB = (await call(auth, 'login', { email: 'owner-sv7@shop.in', password: 'ownerpass1' })).body.sessionToken;
    var add = await call(auth, 'add-staff', { sessionToken: tokA, name: 'Staff', email: 'staff-sv7@shop.in', role: 'staff' });
    eq(add.status, 200, 'add-staff with token A');
    eq((await call(auth, 'remove-staff', { sessionToken: tokA, staffUserId: add.body.user.id })).status, 200, 'remove-staff with token A');
    eq((await call(auth, 'update-shop', { sessionToken: tokA, city: 'Chennai' })).status, 200, 'update-shop with token A');
    eq((await sp(tokB, 'GET')).status, 200, "token B (never involved in any of that) is still perfectly valid");
    eq((await call(auth, 'update-shop', { sessionToken: tokB, city: 'Chennai' })).status, 200, 'token B still works on auth-gateway too');
  });

  await test('remove-staff: a stale (pre-password-change) owner token is rejected, not just add-staff/update-shop', async function () {
    // remove-staff has NO outer loadActor call -- unlike add-staff and
    // update-shop, its sessionVersion re-check happens ONLY inside
    // mutateBlob's apply closure. Opus review (11 Oct) caught this as the
    // one route where that inner check was originally missing entirely.
    var o = await freshShop('sv9');
    var add = await call(auth, 'add-staff', { sessionToken: o.tok, name: 'Staff', email: 'staff-sv9@shop.in', role: 'staff' });
    var staleOwnerTok = o.tok;
    var freshOwnerTok = await call(auth, 'login', { email: 'owner-sv9@shop.in', password: 'ownerpass1' });
    await call(auth, 'change-password', { sessionToken: freshOwnerTok.body.sessionToken, currentPassword: 'ownerpass1', newPassword: 'sv9-new-pass-1' });
    var r = await call(auth, 'remove-staff', { sessionToken: staleOwnerTok, staffUserId: add.body.user.id });
    eq(r.status, 401, 'the stale owner token cannot remove staff');
    eq(r.body.error, 'Your access to this shop has changed — please sign in again', 'the error is the generic ACCESS_CHANGED, not a silent 200');
    var stillThere = db.auth_store.find(function (row) { return row.id === 'users'; }).data.some(function (u) { return u.id === add.body.user.id; });
    eq(stillThere, true, 'the target staff member was NOT removed');
  });

  await test('forced first-login reset: the token change-password returns works on store-proxy immediately', async function () {
    var o = await freshShop('sv8');
    var add = await call(auth, 'add-staff', { sessionToken: o.tok, name: 'New', email: 'new-sv8@shop.in', role: 'staff' });
    var firstLogin = await call(auth, 'login', { email: 'new-sv8@shop.in', password: add.body.tempPassword });
    eq(firstLogin.status, 200, 'first login with the temp password');
    var changed = await call(auth, 'change-password', {
      sessionToken: firstLogin.body.sessionToken, currentPassword: add.body.tempPassword, newPassword: 'sv8-chosen-pass-1',
    });
    eq(changed.status, 200, 'forced change-password');
    eq((await sp(changed.body.sessionToken, 'GET')).status, 200, 'the returned token works on store-proxy right away');
  });

  // ---- unchanged routes still work
  await test('login / change-password / update-shop still work, using the FRESH token change-password returns', async function () {
    var t = (await call(auth, 'login', { email: 'owner@shop.in', password: 'newpass-123' })).body.sessionToken;
    var changed = await call(auth, 'change-password', { sessionToken: t, currentPassword: 'newpass-123', newPassword: 'final-pass-77' });
    eq(changed.status, 200, 'change-password');
    eq(typeof changed.body.sessionToken, 'string', 'change-password returns a fresh sessionToken');
    // The PRE-change token `t` is now stale (sessionVersion bumped) -- this is
    // the whole point of docs/session-versioning-design.md, not a bug.
    eq((await call(auth, 'update-shop', { sessionToken: t, city: 'Vizag' })).status, 401, 'the pre-change token is rejected, not silently still valid');
    eq((await call(auth, 'update-shop', { sessionToken: changed.body.sessionToken, city: 'Vizag' })).status, 200, 'the fresh token from change-password works immediately');
    eq((await call(auth, 'login', { email: 'owner@shop.in', password: 'wrong' })).status, 401, 'wrong password');
  });

  var failed = 0;
  console.log('\nJewelOS Edge Function tests\n' + '='.repeat(50));
  results.forEach(function (r) { if (r[0] === 'FAIL') failed++; console.log('  ' + (r[0] === 'PASS' ? '\u2713' : '\u2717') + ' ' + r[1]); });
  console.log('\n' + (results.length - failed) + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(function (e) { console.error('HARNESS CRASH:', e); process.exit(2); });
