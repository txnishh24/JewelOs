// Pass 5: top-level (load-time) code that touches a global defined by a LATER script tag.
// Same visible symptom as an undeclared reference: the section silently fails at boot.
const acorn = require('acorn');
const fs = require('fs');
const path = require('path');

const ROOT = process.argv[2];
const files = fs.readdirSync(path.join(ROOT, 'js')).filter(f => f.endsWith('.js')).sort();
const order = new Map(files.map((f, i) => [f, i]));

// where each global is declared, and with what kind
const declared = new Map(); // name -> {file, kind}
const asts = [];
for (const f of files) {
  const src = fs.readFileSync(path.join(ROOT, 'js', f), 'utf8');
  const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script', allowReturnOutsideFunction: true });
  asts.push({ f, src, ast });
  ast.body.forEach(st => {
    if (st.type === 'FunctionDeclaration' && st.id) declared.set(st.id.name, { file: f, kind: 'function' });
    else if (st.type === 'VariableDeclaration') st.declarations.forEach(d => {
      if (d.id.type === 'Identifier' && !declared.has(d.id.name))
        declared.set(d.id.name, { file: f, kind: d.init ? 'var-initialised' : 'var' });
    });
  });
}

function lineOfPos(src, pos) { return src.slice(0, pos).split('\n').length; }

const hits = [];
for (const { f, src, ast } of asts) {
  // top-level statements that execute at load: bare calls and IIFEs
  for (const st of ast.body) {
    if (st.type === 'FunctionDeclaration') continue;
    const isExec = st.type === 'ExpressionStatement' || st.type === 'IfStatement' ||
                   st.type === 'TryStatement' || st.type === 'ForStatement' || st.type === 'SwitchStatement';
    if (!isExec) continue;

    (function scan(n, insideFn) {
      if (!n || typeof n.type !== 'string') return;
      // a deferred callback body does not run at load time
      const defers = n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression' ||
                     n.type === 'FunctionDeclaration';
      if (n.type === 'Identifier' && !insideFn) {
        const d = declared.get(n.name);
        if (d && order.get(d.file) > order.get(f))
          hits.push({ name: n.name, usedIn: f, line: lineOfPos(src, n.start), declaredIn: d.file, kind: d.kind });
      }
      if (n.type === 'MemberExpression') {
        scan(n.object, insideFn);
        if (n.computed) scan(n.property, insideFn);
        return;
      }
      if (n.type === 'Property') { if (n.computed) scan(n.key, insideFn); scan(n.value, insideFn); return; }
      for (const k in n) {
        if (k === 'type' || k === 'start' || k === 'end') continue;
        const v = n[k];
        if (Array.isArray(v)) v.forEach(c => c && typeof c.type === 'string' && scan(c, insideFn || defers));
        else if (v && typeof v.type === 'string') scan(v, insideFn || defers);
      }
    })(st, false);
  }
}

console.log('### Load-time code reading a global that a LATER <script> defines');
console.log('(script order: ' + files.join(' -> ') + ')\n');
const seen = new Set();
const real = hits.filter(h => {
  const k = h.name + h.usedIn + h.line;
  if (seen.has(k)) return false;
  seen.add(k);
  return true;
});
if (!real.length) console.log('  none');
real.forEach(h => console.log('  ' + h.name + '  read at ' + h.usedIn + ':' + h.line +
  '  but declared in ' + h.declaredIn + ' (' + h.kind + ')'));
