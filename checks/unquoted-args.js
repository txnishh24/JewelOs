// Finds inline on* handlers built by string concatenation where a value is
// spliced in WITHOUT quotes: onclick="doThing('+id+')".
//
// If the value is a number that is harmless. If it is a string — and every id
// in this app is a UUID — the browser parses the id as arithmetic on names
// that do not exist, so the click throws a silent ReferenceError and the
// button does nothing at all. No error is shown to the user.
const fs = require('fs');
const path = require('path');
const ROOT = process.argv[2];
const files = fs.readdirSync(path.join(ROOT, 'js')).filter(f => f.endsWith('.js')).sort();

const hits = [];
for (const f of files) {
  const src = fs.readFileSync(path.join(ROOT, 'js', f), 'utf8');
  const lines = src.split('\n');
  lines.forEach((line, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;   // comments illustrate this pattern on purpose
    if (!/\bon[a-z]+\s*=\s*\\?"/.test(line)) return;
    // the handler text on this line, from the on*=" up to the closing quote
    const handlers = line.match(/\bon[a-z]+\s*=\s*\\?"[^"]*/g) || [];
    handlers.forEach(h => {
      // a concatenation opening straight after ( or , with no escaped quote:
      //   safe:   foo(\''+id+'\')      broken: foo('+id+')
      const re = /([(,])\s*'\s*\+\s*([A-Za-z_$][\w$.\[\]]*)/g;
      let m;
      while ((m = re.exec(h))) {
        hits.push({ file: f, line: i + 1, arg: m[2], snippet: h.trim().slice(0, 110) });
      }
    });
  });
}

console.log('### Inline handlers splicing a value in without quotes');
console.log('(a string value here becomes a silent no-op when clicked)\n');
if (!hits.length) { console.log('  none'); process.exit(0); }
hits.forEach(h => {
  console.log('  ' + h.file + ':' + h.line + '   argument: ' + h.arg);
  console.log('      ' + h.snippet);
});
console.log('\n' + hits.length + ' site(s) — check whether each argument is numeric (safe) or a string/UUID (broken).');
