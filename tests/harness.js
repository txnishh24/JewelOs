// ─────────────────────────────────────────────────────────────────────────
// JewelOS test harness
// Loads the REAL app source files (every js/*.js, 00 through 10) into a
// sandboxed Node VM with minimal browser stubs, so tests run against the
// actual production code — not a hand-copied re-implementation of it.
// If someone edits app logic without updating this harness, tests still
// exercise the true current behavior.
// ─────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const nodeCrypto = require('crypto');

function makeFakeElement(){
  var el = {
    style: {}, dataset: {}, classList: {
      add(){}, remove(){}, toggle(){}, contains(){ return false; }
    },
    children: [], innerHTML: '', textContent: '', value: '',
    appendChild(){}, addEventListener(){}, removeEventListener(){}, click(){},
    focus(){}, select(){},
    querySelectorAll(){ return []; }, querySelector(){ return null; },
    getAttribute(){ return null; }, setAttribute(){}, remove(){}
  };
  return el;
}

function buildSandbox(){
  var _local = {}, _session = {};
  var sandbox = {
    console: console,
    Date: Date, Math: Math, JSON: JSON, Array: Array, Object: Object,
    parseInt: parseInt, parseFloat: parseFloat, isNaN: isNaN, isFinite: isFinite,
    encodeURIComponent: encodeURIComponent, decodeURIComponent: decodeURIComponent,
    setTimeout: function(fn){ return 0; }, // no-op: we're testing pure logic, not timing behavior
    clearTimeout: function(){},
    setInterval: function(fn){ return 0; }, // no-op: prevents a live interval keeping Node alive forever
    clearInterval: function(){},
    localStorage: {
      getItem: function(k){ return _local.hasOwnProperty(k) ? _local[k] : null; },
      setItem: function(k,v){ _local[k] = String(v); },
      removeItem: function(k){ delete _local[k]; }
    },
    sessionStorage: {
      getItem: function(k){ return _session.hasOwnProperty(k) ? _session[k] : null; },
      setItem: function(k,v){ _session[k] = String(v); },
      removeItem: function(k){ delete _session[k]; }
    },
    // Elements are remembered per id, so a test can read back what the app
    // rendered into one. Returning a fresh stub each call made every write
    // invisible, which is why nothing here could assert on rendered output.
    _els: {},
    document: {
      getElementById: function(id){
        if(!sandbox._els[id]) sandbox._els[id] = makeFakeElement();
        return sandbox._els[id];
      },
      querySelectorAll: function(){ return []; },
      querySelector: function(){ return null; },
      addEventListener: function(){}, removeEventListener: function(){},
      createElement: function(){ return makeFakeElement(); },
      body: makeFakeElement(),
      documentElement: { clientWidth: 375, clientHeight: 667 }, // arbitrary phone-ish size
      hidden: false
    },
    innerWidth: 375, innerHeight: 667, // window.innerWidth/innerHeight (window === sandbox below)
    window: { addEventListener: function(){}, removeEventListener: function(){} },
    addEventListener: function(){}, removeEventListener: function(){},
    navigator: { onLine: true }, // no serviceWorker key — 'in' check should be false, matching Node
    location: { href: 'http://localhost/', reload: function(){}, hostname: 'localhost' },
    // Real WebCrypto (getRandomValues/subtle/randomUUID), not a stub — the
    // PIN module (js/04-orders-detail.js) hashes for real, so tests exercise
    // the real hash path rather than a mock that could hide a real bug.
    // Uint8Array/TextEncoder are the HOST realm's, injected explicitly:
    // vm.createContext gives the sandbox its own realm with its own
    // Uint8Array, and Node's webcrypto rejects a foreign-realm TypedArray
    // passed to getRandomValues. Overriding the sandbox's own constructors
    // with the host's is what makes `new Uint8Array(...)` inside app code
    // produce an object webcrypto actually accepts.
    crypto: nodeCrypto.webcrypto,
    TextEncoder: TextEncoder,
    atob: function(s){ return Buffer.from(s, 'base64').toString('binary'); },
    Uint8Array: Uint8Array,
    fetch: function(){ return Promise.resolve({ ok:true, json: function(){ return Promise.resolve([]); } }); },
    toast: function(){}, // UI no-op in tests
    __resetStorage: function(){ _local = {}; _session = {}; }
  };
  sandbox.window = sandbox; // window.X === X, matches browser global behavior
  vm.createContext(sandbox);
  return sandbox;
}

function loadApp(){
  var sandbox = buildSandbox();
  var jsDir = path.join(__dirname, '..', 'js');
  var files = fs.readdirSync(jsDir).filter(function(f){ return f.endsWith('.js'); }).sort();
  files.forEach(function(f){
    var code = fs.readFileSync(path.join(jsDir, f), 'utf-8');
    try{
      vm.runInContext(code, sandbox, { filename: f });
    }catch(e){
      throw new Error('Failed loading ' + f + ': ' + e.message);
    }
  });
  // A shop that has saved its rates once; the first-run rate gate has its own tests.
  sandbox.S.rates.setAt = '2026-01-01T00:00:00.000Z';
  return sandbox;
}

module.exports = { loadApp: loadApp };
