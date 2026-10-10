// Finds inline on* handlers that splice a record id (or other free-typed
// value) into a single-quoted argument WITHOUT jsAttrEsc() -- the exact
// pattern the 10-11 Oct Phase 5 sweep found and hand-fixed across all 11
// js/ files (see HANDOFF.md, 11 Oct entry).
//
// store-proxy accepts arbitrary JSON per shop blob, so a value like
// product.id or girvi.id can't be trusted verbatim. When it lands inside
// onclick="fn('...')" unescaped, a crafted value containing a literal '
// breaks out of the HTML attribute (not just the JS string) -- the same
// threat model already used to justify every escaping fix in this app.
//
// The marker: in this codebase every such splice is written as a
// single-quoted JS string with the attribute's own quote escaped --
//   onclick="fn(\'' + id + '\')"
// -- so a raw splice looks like \'' + IDENT + '\' in the source text,
// where IDENT is a bare identifier/property/array-index chain (never a
// call). jsAttrEsc(id), escHtml(id), encodeURIComponent(id), Math.round(x)
// etc. all have a ( right after the identifier where this regex expects a
// +, so they never match -- no allowlist needed, the call parens exclude
// themselves structurally.
//
// Deliberately narrow, not a general HTML/JS-escaping linter:
// - Only the \''+X+'\' marker (this app's one JS-string-quoting style,
//   confirmed project-wide -- ES5, single-quoted string literals
//   throughout). A double-quoted-JS-string variant ('"+X+"') would need a
//   different marker and does not occur anywhere in js/ today.
// - Does not flag js/03-billing-numbers.js's single &quot;'+cid+'&quot;
//   site (showCustHistory) -- cid there is already encodeURIComponent()'d
//   at its own assignment, one line above the splice, which this
//   line-local, marker-based check can't see. That site is a different
//   mitigation (percent-encoding, not jsAttrEsc), outside what the Phase 5
//   sweep touched; flagged in HANDOFF.md as read-only-confirmed-safe, not
//   silently re-litigated here.
// - Per-line, like unquoted-args.js's sibling check -- a handler split
//   across lines isn't scanned, matching that script's own limitation.
const fs = require('fs');
const path = require('path');

function findUnescapedIds(src) {
  // A bare local the file itself assigned straight from jsAttrEsc(...) --
  // e.g. `var safeId=jsAttrEsc(p.id);` then spliced as plain safeId below
  // (02-ui-inactivity-modals.js's shared actionsHtml) -- is already safe.
  // Only a BARE name can ever be pre-escaped this way (you can't write
  // `var p.id = ...`), so this never shadows a real property-chain splice.
  const preEscaped = new Set();
  // Negative lookbehind excludes a preceding `.` or word char, so
  // `foo.safeId=jsAttrEsc(x)` (a property, not a bare declaration) can
  // never pollute the allowlist with an unrelated bare `safeId` elsewhere.
  const assignRe = /(?<![.\w$])([A-Za-z_$][\w$]*)\s*=\s*jsAttrEsc\(/g;
  let am;
  while ((am = assignRe.exec(src))) preEscaped.add(am[1]);

  const lines = src.split('\n');
  const hits = [];
  lines.forEach((line, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return; // comments illustrate this pattern on purpose
    const handlers = line.match(/\bon[a-z]+\s*=\s*\\?"[^"]*/g) || [];
    handlers.forEach(h => {
      const re = /\\''\s*\+\s*([A-Za-z_$][\w$.\[\]]*)\s*\+\s*'\\'/g;
      let m;
      while ((m = re.exec(h))) {
        if (preEscaped.has(m[1])) continue;
        hits.push({ line: i + 1, arg: m[1], snippet: h.trim().slice(0, 110) });
      }
    });
  });
  return hits;
}

// Smallest thing that fails if the detector itself breaks -- no fixture
// files exist for any sibling check, so this stays inline (ponytail: one
// runnable check, not a test framework).
function selfTest() {
  const unsafe = findUnescapedIds('var x = \'<button onclick="fn(\\\'\'+p.id+\'\\\')">\'');
  console.assert(unsafe.length === 1 && unsafe[0].arg === 'p.id',
    'self-test FAILED: did not flag a known-unsafe splice');
  const safe = findUnescapedIds('var x = \'<button onclick="fn(\\\'\'+jsAttrEsc(p.id)+\'\\\')">\'');
  console.assert(safe.length === 0,
    'self-test FAILED: flagged a jsAttrEsc-wrapped splice');
  const numeric = findUnescapedIds('var x = \'<button onclick="fn(\'+i+\')">\'');
  console.assert(numeric.length === 0,
    'self-test FAILED: flagged a plain numeric splice (no escape marker at all)');
  const preEscapedLocal = findUnescapedIds(
    'var safeId=jsAttrEsc(p.id);\n' +
    'var x = \'<button onclick="fn(\\\'\'+safeId+\'\\\')">\';'
  );
  console.assert(preEscapedLocal.length === 0,
    'self-test FAILED: flagged a local already assigned from jsAttrEsc()');
  if (unsafe.length !== 1 || unsafe[0].arg !== 'p.id' || safe.length !== 0 || numeric.length !== 0 ||
      preEscapedLocal.length !== 0) {
    console.error('unescaped-ids.js self-test failed -- detector logic is broken, not trustworthy. Fix before relying on its output.');
    process.exit(1);
  }
}

selfTest();

const ROOT = process.argv[2];
const files = fs.readdirSync(path.join(ROOT, 'js')).filter(f => f.endsWith('.js')).sort();

const hits = [];
for (const f of files) {
  const src = fs.readFileSync(path.join(ROOT, 'js', f), 'utf8');
  findUnescapedIds(src).forEach(h => hits.push(Object.assign({ file: f }, h)));
}

console.log('### Inline handlers splicing a value in without jsAttrEsc()');
console.log('(a crafted value here breaks out of the HTML attribute, not just the JS string)\n');
if (!hits.length) { console.log('  none'); process.exit(0); }
hits.forEach(h => {
  console.log('  ' + h.file + ':' + h.line + '   argument: ' + h.arg);
  console.log('      ' + h.snippet);
});
console.log('\n' + hits.length + ' site(s) -- wrap each argument in jsAttrEsc(...).');
process.exit(1);
