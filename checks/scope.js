// Shared-global-scope undeclared-identifier analyzer for the JewelOS plain-script build.
const acorn = require('acorn');
const fs = require('fs');
const path = require('path');

const ROOT = process.argv[2];
const files = fs.readdirSync(path.join(ROOT, 'js')).filter(f => f.endsWith('.js')).sort();

const BUILTINS = new Set(`
Object Function Array Number Boolean String Symbol Date RegExp Math JSON Promise Proxy Reflect Map Set
WeakMap WeakSet Error TypeError RangeError SyntaxError ReferenceError EvalError URIError Intl BigInt
ArrayBuffer DataView Int8Array Uint8Array Uint8ClampedArray Int16Array Uint16Array Int32Array Uint32Array
Float32Array Float64Array BigInt64Array BigUint64Array SharedArrayBuffer Atomics FinalizationRegistry WeakRef
globalThis undefined NaN Infinity eval isNaN isFinite parseInt parseFloat encodeURI encodeURIComponent
decodeURI decodeURIComponent escape unescape arguments this
window document navigator location history screen console alert confirm prompt
setTimeout clearTimeout setInterval clearInterval requestAnimationFrame cancelAnimationFrame
queueMicrotask fetch Headers Request Response AbortController AbortSignal FormData URL URLSearchParams
localStorage sessionStorage indexedDB caches crypto performance
XMLHttpRequest WebSocket EventSource Worker SharedWorker Blob File FileReader FileList
Image Audio Video Option Element HTMLElement HTMLInputElement HTMLCanvasElement Node NodeList
Event CustomEvent MouseEvent KeyboardEvent TouchEvent InputEvent PointerEvent DragEvent
MutationObserver IntersectionObserver ResizeObserver
DOMParser XMLSerializer XPathResult Range Selection Text Comment DocumentFragment
CSS matchMedia getComputedStyle scrollTo scrollBy print focus blur
btoa atob structuredClone reportError
Notification ServiceWorker PushManager Geolocation MediaQueryList
frames parent top self opener closed devicePixelRatio
innerWidth innerHeight outerWidth outerHeight scrollX scrollY pageXOffset pageYOffset
addEventListener removeEventListener dispatchEvent
`.trim().split(/\s+/));

// ---------- scope machinery ----------
function Scope(type, parent) { this.type = type; this.parent = parent; this.vars = new Map(); }
Scope.prototype.declare = function (name, info) { if (!this.vars.has(name)) this.vars.set(name, info); };
Scope.prototype.resolve = function (name) { let s = this; while (s) { if (s.vars.has(name)) return s; s = s.parent; } return null; };

const globalScope = new Scope('global', null);
const references = [];
const implicitGlobalWrites = [];
const declSites = new Map();

function noteDecl(name, file, line, kind) {
  if (!declSites.has(name)) declSites.set(name, []);
  declSites.get(name).push({ file, line, kind });
}

function patternNames(node, out) {
  if (!node) return out;
  switch (node.type) {
    case 'Identifier': out.push(node); break;
    case 'ObjectPattern': node.properties.forEach(p => {
      if (p.type === 'RestElement') patternNames(p.argument, out);
      else patternNames(p.value, out);
    }); break;
    case 'ArrayPattern': node.elements.forEach(e => patternNames(e, out)); break;
    case 'AssignmentPattern': patternNames(node.left, out); break;
    case 'RestElement': patternNames(node.argument, out); break;
  }
  return out;
}

function lineOf(node, lines) {
  let lo = 0, hi = lines.length - 1, pos = node.start;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (lines[mid] <= pos) lo = mid; else hi = mid - 1; }
  return lo + 1;
}
function colOf(node, lines) { return node.start - lines[lineOf(node, lines) - 1] + 1; }

// hoist `var` declarations into a function/global scope, without descending into nested functions
function hoistVars(node, scope, file, lines) {
  if (!node || typeof node.type !== 'string') return;
  const t = node.type;
  if (t === 'FunctionDeclaration' || t === 'FunctionExpression' || t === 'ArrowFunctionExpression') return;
  if (t === 'VariableDeclaration' && node.kind === 'var') {
    node.declarations.forEach(d => patternNames(d.id, []).forEach(id => {
      scope.declare(id.name, { kind: 'var', file, line: lineOf(id, lines) });
      noteDecl(id.name, file, lineOf(id, lines), 'var');
    }));
  }
  for (const k in node) {
    if (k === 'type' || k === 'start' || k === 'end' || k === 'loc') continue;
    const v = node[k];
    if (Array.isArray(v)) v.forEach(c => c && typeof c.type === 'string' && hoistVarsEntry(c, scope, file, lines));
    else if (v && typeof v.type === 'string') hoistVarsEntry(v, scope, file, lines);
  }
}
function hoistVarsEntry(node, scope, file, lines) {
  if (node.type === 'FunctionDeclaration') {
    if (node.id) {
      scope.declare(node.id.name, { kind: 'function', file, line: lineOf(node.id, lines) });
      noteDecl(node.id.name, file, lineOf(node.id, lines), 'function');
    }
    return;
  }
  hoistVars(node, scope, file, lines);
}

// hoist let/const/class/function bindings into a block scope (direct statements only)
function hoistBlock(body, scope, file, lines) {
  body.forEach(st => {
    if (!st) return;
    if (st.type === 'VariableDeclaration' && st.kind !== 'var') {
      st.declarations.forEach(d => patternNames(d.id, []).forEach(id => {
        scope.declare(id.name, { kind: st.kind, file, line: lineOf(id, lines) });
        noteDecl(id.name, file, lineOf(id, lines), st.kind);
      }));
    } else if (st.type === 'ClassDeclaration' && st.id) {
      scope.declare(st.id.name, { kind: 'class', file, line: lineOf(st.id, lines) });
      noteDecl(st.id.name, file, lineOf(st.id, lines), 'class');
    } else if (st.type === 'FunctionDeclaration' && st.id) {
      scope.declare(st.id.name, { kind: 'function', file, line: lineOf(st.id, lines) });
      noteDecl(st.id.name, file, lineOf(st.id, lines), 'function');
    }
  });
}

// ---------- main walker ----------
function walk(node, scope, file, lines) {
  if (!node || typeof node.type !== 'string') return;
  const T = node.type;

  switch (T) {
    case 'Identifier':
      references.push({ name: node.name, file, line: lineOf(node, lines), col: colOf(node, lines), scope });
      return;

    case 'MemberExpression':
      walk(node.object, scope, file, lines);
      if (node.computed) walk(node.property, scope, file, lines);
      return;

    case 'Property':
      if (node.computed) walk(node.key, scope, file, lines);
      walk(node.value, scope, file, lines);
      return;

    case 'MethodDefinition':
    case 'PropertyDefinition':
      if (node.computed) walk(node.key, scope, file, lines);
      walk(node.value, scope, file, lines);
      return;

    case 'LabeledStatement': walk(node.body, scope, file, lines); return;
    case 'BreakStatement':
    case 'ContinueStatement': return;

    case 'VariableDeclaration':
      node.declarations.forEach(d => {
        walkPatternDefaults(d.id, scope, file, lines);
        if (d.init) walk(d.init, scope, file, lines);
      });
      return;

    case 'FunctionDeclaration':
    case 'FunctionExpression':
    case 'ArrowFunctionExpression': {
      const fsc = new Scope('function', scope);
      if (T === 'FunctionExpression' && node.id) fsc.declare(node.id.name, { kind: 'funcexpr-name' });
      node.params.forEach(p => patternNames(p, []).forEach(id => fsc.declare(id.name, { kind: 'param' })));
      if (T !== 'ArrowFunctionExpression') { fsc.declare('arguments', { kind: 'builtin' }); }
      node.params.forEach(p => walkPatternDefaults(p, fsc, file, lines));
      if (node.body.type === 'BlockStatement') {
        hoistVars(node.body, fsc, file, lines);
        hoistBlock(node.body.body, fsc, file, lines);
        node.body.body.forEach(st => walk(st, fsc, file, lines));
      } else walk(node.body, fsc, file, lines);
      return;
    }

    case 'ClassDeclaration':
    case 'ClassExpression': {
      const cs = new Scope('block', scope);
      if (node.id) cs.declare(node.id.name, { kind: 'class' });
      if (node.superClass) walk(node.superClass, cs, file, lines);
      node.body.body.forEach(m => walk(m, cs, file, lines));
      return;
    }

    case 'BlockStatement': {
      const bs = new Scope('block', scope);
      hoistBlock(node.body, bs, file, lines);
      node.body.forEach(st => walk(st, bs, file, lines));
      return;
    }

    case 'ForStatement': {
      const bs = new Scope('block', scope);
      if (node.init && node.init.type === 'VariableDeclaration' && node.init.kind !== 'var') hoistBlock([node.init], bs, file, lines);
      if (node.init) walk(node.init, bs, file, lines);
      if (node.test) walk(node.test, bs, file, lines);
      if (node.update) walk(node.update, bs, file, lines);
      walk(node.body, bs, file, lines);
      return;
    }

    case 'ForInStatement':
    case 'ForOfStatement': {
      const bs = new Scope('block', scope);
      if (node.left.type === 'VariableDeclaration') {
        if (node.left.kind !== 'var') hoistBlock([node.left], bs, file, lines);
        node.left.declarations.forEach(d => walkPatternDefaults(d.id, bs, file, lines));
      } else walk(node.left, bs, file, lines);
      walk(node.right, bs, file, lines);
      walk(node.body, bs, file, lines);
      return;
    }

    case 'SwitchStatement': {
      walk(node.discriminant, scope, file, lines);
      const bs = new Scope('block', scope);
      node.cases.forEach(c => hoistBlock(c.consequent, bs, file, lines));
      node.cases.forEach(c => {
        if (c.test) walk(c.test, bs, file, lines);
        c.consequent.forEach(st => walk(st, bs, file, lines));
      });
      return;
    }

    case 'CatchClause': {
      const bs = new Scope('block', scope);
      if (node.param) {
        patternNames(node.param, []).forEach(id => bs.declare(id.name, { kind: 'catch' }));
        walkPatternDefaults(node.param, bs, file, lines);
      }
      hoistBlock(node.body.body, bs, file, lines);
      node.body.body.forEach(st => walk(st, bs, file, lines));
      return;
    }
  }

  for (const k in node) {
    if (k === 'type' || k === 'start' || k === 'end' || k === 'loc') continue;
    const v = node[k];
    if (Array.isArray(v)) v.forEach(c => c && typeof c.type === 'string' && walk(c, scope, file, lines));
    else if (v && typeof v.type === 'string') walk(v, scope, file, lines);
  }
}

// inside a binding pattern only default-value expressions and computed keys are references
function walkPatternDefaults(node, scope, file, lines) {
  if (!node) return;
  switch (node.type) {
    case 'Identifier': return;
    case 'AssignmentPattern': walkPatternDefaults(node.left, scope, file, lines); walk(node.right, scope, file, lines); return;
    case 'ObjectPattern': node.properties.forEach(p => {
      if (p.type === 'RestElement') { walkPatternDefaults(p.argument, scope, file, lines); return; }
      if (p.computed) walk(p.key, scope, file, lines);
      walkPatternDefaults(p.value, scope, file, lines);
    }); return;
    case 'ArrayPattern': node.elements.forEach(e => walkPatternDefaults(e, scope, file, lines)); return;
    case 'RestElement': walkPatternDefaults(node.argument, scope, file, lines); return;
    default: walk(node, scope, file, lines);
  }
}

// ---------- pass 1: parse everything, hoist top level into the one shared global scope ----------
const parsed = [];
for (const f of files) {
  const src = fs.readFileSync(path.join(ROOT, 'js', f), 'utf8');
  const lines = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === '\n') lines.push(i + 1);
  let ast;
  try {
    ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script', allowReturnOutsideFunction: true });
  } catch (e) {
    console.log('PARSE ERROR ' + f + ': ' + e.message);
    continue;
  }
  parsed.push({ f, src, lines, ast });
  hoistVars(ast, globalScope, f, lines);
  hoistBlock(ast.body, globalScope, f, lines);
}

// bare assignments create implicit globals in sloppy mode
function collectImplicitGlobals(node, file, lines) {
  if (!node || typeof node.type !== 'string') return;
  if (node.type === 'AssignmentExpression' && node.left.type === 'Identifier') {
    implicitGlobalWrites.push({ name: node.left.name, file, line: lineOf(node.left, lines) });
  }
  for (const k in node) {
    if (k === 'type' || k === 'start' || k === 'end') continue;
    const v = node[k];
    if (Array.isArray(v)) v.forEach(c => c && typeof c.type === 'string' && collectImplicitGlobals(c, file, lines));
    else if (v && typeof v.type === 'string') collectImplicitGlobals(v, file, lines);
  }
}
parsed.forEach(p => collectImplicitGlobals(p.ast, p.f, p.lines));

// ---------- pass 2: resolve every reference ----------
parsed.forEach(p => p.ast.body.forEach(st => walk(st, globalScope, p.f, p.lines)));

// ---------- report ----------
const implicitNames = new Set(
  implicitGlobalWrites.filter(w => !globalScope.vars.has(w.name) && !declSites.has(w.name)).map(w => w.name)
);

const tierA = [], tierB = [];
for (const r of references) {
  if (BUILTINS.has(r.name)) continue;
  if (r.scope.resolve(r.name)) continue;
  if (globalScope.vars.has(r.name)) continue;
  if (declSites.has(r.name)) { tierB.push(r); continue; }
  if (implicitNames.has(r.name)) continue;
  tierA.push(r);
}

function group(list) {
  const m = new Map();
  list.forEach(r => { if (!m.has(r.name)) m.set(r.name, []); m.get(r.name).push(r); });
  return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
}

console.log('### TIER A - never declared anywhere (guaranteed ReferenceError when read)');
for (const [name, rs] of group(tierA))
  console.log('  ' + name + '  (' + rs.length + 'x)  ' + rs.slice(0, 8).map(r => r.file + ':' + r.line).join(', ') + (rs.length > 8 ? ' ...' : ''));

console.log('\n### TIER B - declared somewhere but not visible from the use site (scope mismatch)');
for (const [name, rs] of group(tierB))
  console.log('  ' + name + '  (' + rs.length + 'x) used at ' + rs.slice(0, 8).map(r => r.file + ':' + r.line).join(', ') +
    '  || declared: ' + (declSites.get(name) || []).slice(0, 4).map(d => d.file + ':' + d.line + '(' + d.kind + ')').join(', '));

console.log('\n### IMPLICIT GLOBALS (bare assignment, never declared - works in sloppy mode, fragile)');
const ig = new Map();
implicitGlobalWrites.filter(w => implicitNames.has(w.name)).forEach(w => {
  if (!ig.has(w.name)) ig.set(w.name, []);
  ig.get(w.name).push(w);
});
for (const [n, ws] of ig) console.log('  ' + n + '  ' + ws.slice(0, 5).map(w => w.file + ':' + w.line).join(', '));

console.log('\n(parsed ' + parsed.length + ' files, ' + references.length + ' identifier references, ' + globalScope.vars.size + ' globals)');

fs.writeFileSync(path.join(__dirname, 'globals.json'), JSON.stringify({
  globals: [...globalScope.vars.keys()],
  allDeclared: [...declSites.keys()],
  implicit: [...implicitNames]
}, null, 1));
