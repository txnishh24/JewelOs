// Pass 2: identifiers referenced from strings — inline on* handlers in index.html
// and in HTML built by string concatenation inside the JS files.
const acorn = require('acorn');
const fs = require('fs');
const path = require('path');

const ROOT = process.argv[2];
const G = JSON.parse(fs.readFileSync(path.join(__dirname, 'globals.json'), 'utf8'));
const known = new Set([...G.globals, ...G.implicit]); // inline handlers run in GLOBAL scope only

const BUILTIN_CALLS = new Set(`
alert confirm prompt parseInt parseFloat isNaN isFinite String Number Boolean Array Object Date Math JSON
setTimeout setInterval clearTimeout clearInterval encodeURIComponent decodeURIComponent
eval Function print open close focus blur require return if for while switch catch typeof void delete new
`.trim().split(/\s+/));

const findings = [];   // {name, file, line, snippet, kind}
const seenPairs = new Set();

function lineOfPos(src, pos) { return src.slice(0, pos).split('\n').length; }

// pull `name(` call targets out of an inline-handler body
function scanHandlerBody(body, file, line, kind, rawSnippet) {
  const re = /(^|[^.\w$'"])([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g;
  let m;
  while ((m = re.exec(body))) {
    const name = m[2];
    if (BUILTIN_CALLS.has(name)) continue;
    if (known.has(name)) continue;
    const key = name + '@' + file + ':' + line;
    if (seenPairs.has(key)) continue;
    seenPairs.add(key);
    findings.push({ name, file, line, kind, snippet: rawSnippet.slice(0, 150) });
  }
}

// ---------- index.html inline attributes ----------
const htmlPath = path.join(ROOT, 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const attrRe = /\bon([a-z]+)\s*=\s*"([^"]*)"/g;
let m;
let htmlCount = 0;
while ((m = attrRe.exec(html))) {
  htmlCount++;
  scanHandlerBody(m[2], 'index.html', lineOfPos(html, m.index), 'inline attr on' + m[1], m[0]);
}
// javascript: hrefs
const jsHrefRe = /href\s*=\s*"javascript:([^"]*)"/g;
while ((m = jsHrefRe.exec(html))) {
  scanHandlerBody(m[1], 'index.html', lineOfPos(html, m.index), 'javascript: href', m[0]);
}

// ---------- string literals inside the JS files ----------
const files = fs.readdirSync(path.join(ROOT, 'js')).filter(f => f.endsWith('.js')).sort();
let litCount = 0;
for (const f of files) {
  const src = fs.readFileSync(path.join(ROOT, 'js', f), 'utf8');
  let ast;
  try { ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script', allowReturnOutsideFunction: true }); }
  catch (e) { continue; }

  const lits = [];
  (function collect(n) {
    if (!n || typeof n.type !== 'string') return;
    if (n.type === 'Literal' && typeof n.value === 'string') lits.push(n);
    if (n.type === 'TemplateLiteral') n.quasis.forEach(q => lits.push({ value: q.value.cooked || '', start: q.start }));
    for (const k in n) {
      if (k === 'type' || k === 'start' || k === 'end') continue;
      const v = n[k];
      if (Array.isArray(v)) v.forEach(c => c && typeof c.type === 'string' && collect(c));
      else if (v && typeof v.type === 'string') collect(v);
    }
  })(ast);

  for (const lit of lits) {
    const s = lit.value;
    if (!/on[a-z]+\s*=/.test(s) && !/javascript:/.test(s)) continue;
    litCount++;
    const line = lineOfPos(src, lit.start);
    // handler body may be cut off by concatenation; take the rest of the literal
    const hre = /\bon([a-z]+)\s*=\s*(?:\\?["'])?([^"']{0,200})/g;
    let hm;
    while ((hm = hre.exec(s))) {
      scanHandlerBody(hm[2], f, line, 'string on' + hm[1], s.trim());
    }
    const jre = /javascript:([\s\S]{0,120})/g;
    while ((hm = jre.exec(s))) scanHandlerBody(hm[1], f, line, 'string javascript:', s.trim());
  }
}

// ---------- report ----------
const byName = new Map();
findings.forEach(fd => { if (!byName.has(fd.name)) byName.set(fd.name, []); byName.get(fd.name).push(fd); });

console.log('### Handler targets referenced from strings but NOT declared anywhere');
console.log('(scanned ' + htmlCount + ' inline attributes in index.html, ' + litCount + ' handler-bearing JS string literals)\n');
if (!byName.size) console.log('  none');
for (const [name, fds] of [...byName.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.log('  ' + name + '  (' + fds.length + ' site' + (fds.length > 1 ? 's' : '') + ')');
  fds.slice(0, 6).forEach(fd => console.log('      ' + fd.file + ':' + fd.line + '  [' + fd.kind + ']  ' + fd.snippet.replace(/\s+/g, ' ').slice(0, 110)));
  if (fds.length > 6) console.log('      ... +' + (fds.length - 6) + ' more');
}
