// Build a Netlify deploy zip from THIS folder.
//
//   node build-deploy-zip.js batch20
//
// Why this script exists: on 12 Sep two deploys in a row came up with every
// js/*.js returning 404, because the zip had been made with PowerShell's
// Compress-Archive, which stores paths with a BACKSLASH separator. The ZIP
// spec requires "/", and Netlify's unzip takes the name literally — so
// "js\00-config-state.js" became one oddly-named file at the site root
// instead of a js/ folder. Nothing in the pipeline caught it.
//
// So this does three things, and refuses to hand you a zip unless all three
// pass: it builds with a tool that writes "/" (7-Zip), it reads the finished
// archive's central directory back and checks every stored name, and it
// extracts the archive and byte-compares each file against the repo.
var fs = require('fs'), path = require('path'), cp = require('child_process'), os = require('os');

var batch = process.argv[2];
if (!batch) { console.error('usage: node build-deploy-zip.js <batchName>   e.g. batch20'); process.exit(1); }

var root = __dirname;
var changesDoc = path.join(root, 'docs', 'CHANGES-' + batch + '.md');
if (!fs.existsSync(changesDoc)) {
  console.error('missing ' + path.relative(root, changesDoc) + ' — write the changelog before building.');
  process.exit(1);
}

// Everything the live site serves. A Netlify drag REPLACES the whole site, so
// anything missing here 404s after deploy — not just the code.
var files = ['index.html', 'manifest.json', 'icon-192.png', 'icon-512.png'];
fs.readdirSync(path.join(root, 'js')).filter(function (f) { return /\.js$/.test(f); })
  .sort().forEach(function (f) { files.push('js/' + f); });

var sevenZip = 'C:/Program Files/7-Zip/7z.exe';
if (!fs.existsSync(sevenZip)) {
  console.error('7-Zip not found at ' + sevenZip + '.\n' +
    'Do NOT fall back to Compress-Archive — it writes backslash paths and breaks the deploy.');
  process.exit(1);
}

var stage = fs.mkdtempSync(path.join(os.tmpdir(), 'jewelos-' + batch + '-'));
files.forEach(function (rel) {
  var dest = path.join(stage, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(path.join(root, rel), dest);
});
// Shipped as CHANGELOG.md at the site root, matching earlier batches.
fs.copyFileSync(changesDoc, path.join(stage, 'CHANGELOG.md'));
var shipped = files.concat(['CHANGELOG.md']);

var outDir = process.env.USERPROFILE ? path.join(process.env.USERPROFILE, 'Downloads') : root;
var outFile = path.join(outDir, 'jewelos-' + batch + '-DEPLOY.zip');
fs.rmSync(outFile, { force: true });

var r = cp.spawnSync(sevenZip, ['a', '-tzip', '-mx=9', outFile, '.'], { cwd: stage, encoding: 'utf8' });
if (r.status !== 0) { console.error('7-Zip failed:\n' + (r.stdout || '') + (r.stderr || '')); process.exit(1); }

// ── check 1: every stored name uses "/" ───────────────────────────────
// Read the central directory directly; a listing tool may normalise the
// display and hide the exact bug this is looking for.
var buf = fs.readFileSync(outFile);
var eocd = -1;
for (var i = buf.length - 22; i >= 0; i--) { if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; } }
if (eocd === -1) { console.error('could not find the zip central directory'); process.exit(1); }
var count = buf.readUInt16LE(eocd + 10), at = buf.readUInt32LE(eocd + 16);
var names = [], bad = [];
for (var n = 0; n < count; n++) {
  if (buf.readUInt32LE(at) !== 0x02014b50) { console.error('bad central directory entry ' + n); process.exit(1); }
  var nameLen = buf.readUInt16LE(at + 28), extraLen = buf.readUInt16LE(at + 30), cmtLen = buf.readUInt16LE(at + 32);
  var name = buf.slice(at + 46, at + 46 + nameLen).toString('utf8');
  names.push(name);
  if (name.indexOf('\\') !== -1) bad.push(name);
  at += 46 + nameLen + extraLen + cmtLen;
}
if (bad.length) {
  console.error('REFUSING TO SHIP — these entries use backslash separators:\n  ' + bad.join('\n  '));
  fs.rmSync(outFile, { force: true });
  process.exit(1);
}

// ── check 2: extracted bytes match the repo ───────────────────────────
var verifyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jewelos-verify-'));
var x = cp.spawnSync(sevenZip, ['x', '-y', '-o' + verifyDir, outFile], { encoding: 'utf8' });
if (x.status !== 0) { console.error('could not extract for verification'); process.exit(1); }

var mismatches = [];
shipped.forEach(function (rel) {
  var src = rel === 'CHANGELOG.md' ? changesDoc : path.join(root, rel);
  var got = path.join(verifyDir, rel);
  if (!fs.existsSync(got)) { mismatches.push(rel + ' (missing from zip)'); return; }
  if (Buffer.compare(fs.readFileSync(src), fs.readFileSync(got)) !== 0) mismatches.push(rel + ' (bytes differ)');
});
// and nothing extra rode along
names.forEach(function (nm) {
  if (nm.slice(-1) === '/') return;
  if (shipped.indexOf(nm) === -1) mismatches.push(nm + ' (unexpected file in zip)');
});

fs.rmSync(stage, { recursive: true, force: true });
fs.rmSync(verifyDir, { recursive: true, force: true });

if (mismatches.length) {
  console.error('REFUSING TO SHIP — zip does not match the repo:\n  ' + mismatches.join('\n  '));
  fs.rmSync(outFile, { force: true });
  process.exit(1);
}

console.log('built ' + outFile);
console.log('  ' + names.filter(function (n) { return n.slice(-1) !== '/'; }).length +
  ' files, ' + (fs.statSync(outFile).size / 1024).toFixed(1) + ' KB');
console.log('  every stored path uses "/"');
console.log('  every file byte-matches this folder');
console.log('\nentries:');
names.slice().sort().forEach(function (n) { if (n.slice(-1) !== '/') console.log('  ' + n); });
