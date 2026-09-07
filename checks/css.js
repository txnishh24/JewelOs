// Pass 3: CSS classes referenced by markup/JS but never defined in the stylesheet.
const acorn = require('acorn');
const fs = require('fs');
const path = require('path');

const ROOT = process.argv[2];
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

// ---------- defined classes: selector portions of every rule in <style> ----------
const styleBlocks = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]);
const defined = new Map(); // class -> first line
let css = styleBlocks.join('\n').replace(/\/\*[\s\S]*?\*\//g, '');
const styleStart = html.indexOf('<style');
const styleStartLine = html.slice(0, styleStart).split('\n').length;

for (const m of css.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
  const sel = m[1];
  const line = styleStartLine + css.slice(0, m.index).split('\n').length - 1;
  for (const c of sel.matchAll(/\.(-?[A-Za-z_][A-Za-z0-9_-]*)/g)) {
    if (!defined.has(c[1])) defined.set(c[1], line);
  }
}

// ---------- also: stylesheets the JS builds for print/invoice documents ----------
// Those are complete HTML docs with their own <style>, so their classes ARE defined.
function harvestEmbeddedCss(text, label) {
  for (const m of text.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    const decls = m[2];
    if (!/[a-zA-Z-]+\s*:\s*[^;{}]+/.test(decls)) continue; // must look like CSS declarations
    for (const c of m[1].matchAll(/\.(-?[A-Za-z_][A-Za-z0-9_-]*)/g))
      if (!defined.has(c[1])) defined.set(c[1], label);
  }
}

// ---------- used classes ----------
const used = new Map(); // class -> [{file,line,how}]
function use(cls, file, line, how) {
  if (!cls || !/^-?[A-Za-z_][A-Za-z0-9_-]*$/.test(cls)) return;
  if (!used.has(cls)) used.set(cls, []);
  used.get(cls).push({ file, line, how });
}
function lineOfPos(src, pos) { return src.slice(0, pos).split('\n').length; }

// class="..." in index.html
for (const m of html.matchAll(/\bclass\s*=\s*"([^"]*)"/g)) {
  const line = lineOfPos(html, m.index);
  m[1].split(/\s+/).forEach(c => use(c, 'index.html', line, 'class attr'));
}

// ---------- JS sources ----------
const files = fs.readdirSync(path.join(ROOT, 'js')).filter(f => f.endsWith('.js')).sort();
// property keys whose string values are class names (ORD_STATUS-style lookup tables)
const CLASS_VALUE_KEYS = new Set(['cls', 'class', 'className', 'classes', 'badge', 'badgeCls', 'cssClass', 'pillCls', 'chipCls', 'tagCls', 'statusCls', 'color', 'variant']);

for (const f of files) {
  const src = fs.readFileSync(path.join(ROOT, 'js', f), 'utf8');
  let ast;
  try { ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script', allowReturnOutsideFunction: true }); }
  catch (e) { continue; }

  // first: harvest any CSS this file embeds in generated documents
  const allLits = [];
  (function grab(n) {
    if (!n || typeof n.type !== 'string') return;
    if (n.type === 'Literal' && typeof n.value === 'string') allLits.push(n.value);
    if (n.type === 'TemplateLiteral') n.quasis.forEach(q => allLits.push(q.value.cooked || ''));
    for (const k in n) {
      if (k === 'type' || k === 'start' || k === 'end') continue;
      const v = n[k];
      if (Array.isArray(v)) v.forEach(c => c && typeof c.type === 'string' && grab(c));
      else if (v && typeof v.type === 'string') grab(v);
    }
  })(ast);
  harvestEmbeddedCss(allLits.join('\n'), f + ' (generated doc CSS)');

  (function walk(n, parent) {
    if (!n || typeof n.type !== 'string') return;

    // string literals containing class="..." (HTML built by concatenation)
    if (n.type === 'Literal' && typeof n.value === 'string') {
      const line = lineOfPos(src, n.start);
      for (const m of n.value.matchAll(/\bclass\s*=\s*(?:\\?["'])([^"']*)/g))
        m[1].split(/\s+/).forEach(c => use(c, f, line, 'class attr in string'));
    }

    // obj.className = 'a b' / += 'a b'
    if (n.type === 'AssignmentExpression' && n.left.type === 'MemberExpression' &&
        !n.left.computed && n.left.property.name === 'className') {
      (function lits(x) {
        if (!x) return;
        if (x.type === 'Literal' && typeof x.value === 'string')
          x.value.split(/\s+/).forEach(c => use(c, f, lineOfPos(src, x.start), 'className='));
        if (x.type === 'BinaryExpression') { lits(x.left); lits(x.right); }
        if (x.type === 'ConditionalExpression') { lits(x.consequent); lits(x.alternate); }
        if (x.type === 'TemplateLiteral') x.quasis.forEach(q =>
          (q.value.cooked || '').split(/\s+/).forEach(c => use(c, f, lineOfPos(src, x.start), 'className=')));
      })(n.right);
    }

    // classList.add/remove/toggle/contains/replace('x')
    if (n.type === 'CallExpression' && n.callee.type === 'MemberExpression' && !n.callee.computed &&
        /^(add|remove|toggle|contains|replace)$/.test(n.callee.property.name || '') &&
        n.callee.object.type === 'MemberExpression' && n.callee.object.property.name === 'classList') {
      n.arguments.forEach(a => {
        if (a.type === 'Literal' && typeof a.value === 'string')
          use(a.value, f, lineOfPos(src, a.start), 'classList.' + n.callee.property.name);
      });
    }

    // lookup-table style: { cls:'ord-st-new' }
    if (n.type === 'Property' && !n.computed) {
      const key = n.key.name || n.key.value;
      if (CLASS_VALUE_KEYS.has(key) && n.value.type === 'Literal' && typeof n.value.value === 'string')
        n.value.value.split(/\s+/).forEach(c => use(c, f, lineOfPos(src, n.value.start), key + ': lookup table'));
    }

    for (const k in n) {
      if (k === 'type' || k === 'start' || k === 'end') continue;
      const v = n[k];
      if (Array.isArray(v)) v.forEach(c => c && typeof c.type === 'string' && walk(c, n));
      else if (v && typeof v.type === 'string') walk(v, n);
    }
  })(ast, null);
}

// ---------- report ----------
const undefinedUsed = [...used.entries()].filter(([c]) => !defined.has(c));

// family analysis: a prefix where siblings ARE styled but this one is not
function family(cls) {
  const parts = cls.split('-');
  for (let i = parts.length - 1; i >= 1; i--) {
    const pre = parts.slice(0, i).join('-') + '-';
    const sibs = [...defined.keys()].filter(d => d.startsWith(pre) && d !== cls);
    if (sibs.length >= 2) return { pre, sibs };
  }
  return null;
}

console.log('### CSS classes USED but never DEFINED in the stylesheet');
console.log('(' + defined.size + ' classes defined, ' + used.size + ' distinct classes used)\n');

const withFam = [], without = [];
undefinedUsed.forEach(e => (family(e[0]) ? withFam : without).push(e));

console.log('--- HIGH SIGNAL: sibling classes in the same family ARE styled ---');
if (!withFam.length) console.log('  none');
withFam.sort((a, b) => a[0].localeCompare(b[0])).forEach(([c, sites]) => {
  const fam = family(c);
  console.log('  .' + c + '  (' + sites.length + ' use' + (sites.length > 1 ? 's' : '') + ')');
  console.log('      used: ' + sites.slice(0, 4).map(s => s.file + ':' + s.line + ' [' + s.how + ']').join(', '));
  console.log('      styled siblings: ' + fam.sibs.slice(0, 6).map(s => '.' + s).join(', '));
});

console.log('\n--- other used-but-unstyled classes (often intentional JS hooks) ---');
console.log('  ' + without.map(e => '.' + e[0]).sort().join('  '));
