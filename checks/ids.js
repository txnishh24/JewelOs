// Pass 4: element ids looked up by JS but never present in any markup the app produces.
const acorn = require('acorn');
const fs = require('fs');
const path = require('path');

const ROOT = process.argv[2];
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const files = fs.readdirSync(path.join(ROOT, 'js')).filter(f => f.endsWith('.js')).sort();

const definedIds = new Map();   // id -> where
const refs = [];                // {id, file, line, how}
const dynamicPrefixes = [];     // literal prefixes of concatenated ids, both defined and referenced

function lineOfPos(src, pos) { return src.slice(0, pos).split('\n').length; }
function defId(id, where) { if (id && !definedIds.has(id)) definedIds.set(id, where); }

// ---- ids present in index.html ----
for (const m of html.matchAll(/\bid\s*=\s*"([^"]*)"/g)) defId(m[1].trim(), 'index.html:' + lineOfPos(html, m.index));

for (const f of files) {
  const src = fs.readFileSync(path.join(ROOT, 'js', f), 'utf8');
  let ast;
  try { ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script', allowReturnOutsideFunction: true }); }
  catch (e) { continue; }

  (function walk(n) {
    if (!n || typeof n.type !== 'string') return;
    const line = () => lineOfPos(src, n.start);

    // ids in generated HTML strings
    if (n.type === 'Literal' && typeof n.value === 'string') {
      for (const m of n.value.matchAll(/\bid\s*=\s*(?:\\?["'])([^"'\\]*)/g)) {
        const raw = m[1].trim();
        if (!raw) { continue; }
        defId(raw, f + ':' + line());
        // 'oi-desc-'+i  ->  remember the prefix so concatenated lookups resolve
        if (/[-_]$/.test(raw)) dynamicPrefixes.push(raw);
      }
    }
    if (n.type === 'TemplateLiteral') {
      n.quasis.forEach(q => {
        for (const m of (q.value.cooked || '').matchAll(/\bid\s*=\s*(?:\\?["'])([^"'\\]*)/g)) {
          const raw = m[1].trim();
          if (raw) { defId(raw, f + ':' + line()); if (/[-_]$/.test(raw)) dynamicPrefixes.push(raw); }
        }
      });
    }

    // el.id = 'x'
    if (n.type === 'AssignmentExpression' && n.left.type === 'MemberExpression' &&
        !n.left.computed && n.left.property.name === 'id' &&
        n.right.type === 'Literal' && typeof n.right.value === 'string') {
      defId(n.right.value, f + ':' + line());
    }
    // setAttribute('id','x')
    if (n.type === 'CallExpression' && n.callee.type === 'MemberExpression' &&
        n.callee.property.name === 'setAttribute' && n.arguments.length === 2 &&
        n.arguments[0].type === 'Literal' && n.arguments[0].value === 'id' &&
        n.arguments[1].type === 'Literal') {
      defId(String(n.arguments[1].value), f + ':' + line());
    }

    // ---- lookups ----
    if (n.type === 'CallExpression' && n.callee.type === 'MemberExpression' && !n.callee.computed) {
      const fn = n.callee.property.name;
      const a0 = n.arguments[0];
      if (fn === 'getElementById' && a0) {
        if (a0.type === 'Literal' && typeof a0.value === 'string')
          refs.push({ id: a0.value, file: f, line: line(), how: 'getElementById' });
        else if (a0.type === 'BinaryExpression' && a0.left.type === 'Literal' && typeof a0.left.value === 'string')
          refs.push({ id: a0.left.value, file: f, line: line(), how: 'getElementById (prefix)', prefix: true });
      }
      if ((fn === 'querySelector' || fn === 'querySelectorAll') && a0 &&
          a0.type === 'Literal' && typeof a0.value === 'string' && a0.value.startsWith('#') &&
          /^#[A-Za-z_][\w-]*$/.test(a0.value)) {
        refs.push({ id: a0.value.slice(1), file: f, line: line(), how: fn });
      }
    }

    for (const k in n) {
      if (k === 'type' || k === 'start' || k === 'end') continue;
      const v = n[k];
      if (Array.isArray(v)) v.forEach(c => c && typeof c.type === 'string' && walk(c));
      else if (v && typeof v.type === 'string') walk(v);
    }
  })(ast);
}

// also ids referenced from inline handlers in index.html
for (const m of html.matchAll(/getElementById\(\s*'([^']+)'\s*\)/g))
  refs.push({ id: m[1], file: 'index.html', line: lineOfPos(html, m.index), how: 'getElementById (inline)' });

// ---------- report ----------
const missing = new Map();
for (const r of refs) {
  if (definedIds.has(r.id)) continue;
  if (r.prefix) { if (dynamicPrefixes.some(p => p === r.id || p.startsWith(r.id) || r.id.startsWith(p))) continue; }
  // a concatenated id may be defined under a prefix we captured
  if (dynamicPrefixes.some(p => r.id.startsWith(p))) continue;
  if ([...definedIds.keys()].some(d => d.startsWith(r.id) && r.prefix)) continue;
  if (!missing.has(r.id)) missing.set(r.id, []);
  missing.get(r.id).push(r);
}

console.log('### Element ids looked up but never produced in any markup');
console.log('(' + definedIds.size + ' ids defined, ' + refs.length + ' lookups, ' + dynamicPrefixes.length + ' dynamic id prefixes)\n');
if (!missing.size) console.log('  none');
for (const [id, rs] of [...missing.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.log('  #' + id + '  (' + rs.length + ' lookup' + (rs.length > 1 ? 's' : '') + ')  ' +
    rs.slice(0, 6).map(r => r.file + ':' + r.line + ' [' + r.how + ']').join(', '));
}
