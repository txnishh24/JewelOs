// Stage the servable files for `wrangler deploy` into cf-deploy-stage/ (gitignored).
//
//   node build-cf-deploy-stage.js batch20
//
// Same file list as build-deploy-zip.js (Netlify), staged as a real directory
// instead of a zip, because wrangler.jsonc's assets.directory needs one to
// point at. Kept as a SIBLING of wrangler.jsonc, never containing it — the
// 10 Oct Cloudflare deploy briefly served wrangler.jsonc and .wrangler/ publicly
// because they were staged inside the assets directory itself (see HANDOFF.md).
var fs = require('fs'), path = require('path');

var batch = process.argv[2];
if (!batch) { console.error('usage: node build-cf-deploy-stage.js <batchName>   e.g. batch20'); process.exit(1); }

var root = __dirname;
var changesDoc = path.join(root, 'docs', 'CHANGES-' + batch + '.md');
if (!fs.existsSync(changesDoc)) {
  console.error('missing ' + path.relative(root, changesDoc) + ' — write the changelog before staging.');
  process.exit(1);
}

var files = ['index.html', 'manifest.json', 'icon-192.png', 'icon-512.png', 'sw.js'];
fs.readdirSync(path.join(root, 'js')).filter(function (f) { return /\.js$/.test(f); })
  .sort().forEach(function (f) { files.push('js/' + f); });

var stageDir = path.join(root, 'cf-deploy-stage');
fs.rmSync(stageDir, { recursive: true, force: true });
files.forEach(function (rel) {
  var dest = path.join(stageDir, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(path.join(root, rel), dest);
});
fs.copyFileSync(changesDoc, path.join(stageDir, 'CHANGELOG.md'));

console.log('staged ' + (files.length + 1) + ' files into ' + stageDir);
console.log('next: npx wrangler deploy --dry-run   (then without --dry-run once checked)');
