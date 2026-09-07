// Confirms the backup export and the restore handle the same set of keys,
// and that neither drifts from the state the app actually keeps.
const fs = require('fs');
const path = require('path');
const ROOT = process.argv[2];

const auth = fs.readFileSync(path.join(ROOT, 'js', '05-auth-login.js'), 'utf8');

const dataBlock = auth.match(/data:\s*\{([\s\S]*?)\n {4}\}/);
const exported = [...dataBlock[1].matchAll(/^ {6}([a-zA-Z]+):/gm)].map(m => m[1]);
const restored = [...new Set([...auth.matchAll(/if\(d\.([a-zA-Z]+)\)/g)].map(m => m[1]))];

console.log('exported (' + exported.length + '): ' + exported.join(' '));
console.log('');
console.log('restored (' + restored.length + '): ' + restored.join(' '));
console.log('');

const missing = exported.filter(k => !restored.includes(k));
const orphan = restored.filter(k => !exported.includes(k));
console.log(missing.length ? '!! EXPORTED BUT NOT RESTORED: ' + missing.join(' ') : 'OK  every exported key is restored');
console.log(orphan.length ? '!! RESTORED BUT NOT EXPORTED: ' + orphan.join(' ') : 'OK  no orphan restore keys');

// what state does the app actually keep?
const files = fs.readdirSync(path.join(ROOT, 'js')).filter(f => f.endsWith('.js'));
const seen = new Map();
for (const f of files) {
  const src = fs.readFileSync(path.join(ROOT, 'js', f), 'utf8');
  for (const m of src.matchAll(/\bS\.([a-zA-Z_][a-zA-Z0-9_]*)/g))
    seen.set(m[1], (seen.get(m[1]) || 0) + 1);
}
// account/auth state is deliberately excluded from backups
const ACCOUNT = new Set(['shop', 'user', 'plan', 'sessionToken', 'shopId', 'trialEndsAt', 'planExpiry']);
const uncovered = [...seen.entries()]
  .filter(([k, n]) => n >= 8 && !exported.includes(k) && !ACCOUNT.has(k))
  .sort((a, b) => b[1] - a[1]);

console.log('');
console.log(uncovered.length
  ? '!! SHOP STATE NOT IN BACKUP: ' + uncovered.map(([k, n]) => k + ' (' + n + ' refs)').join(', ')
  : 'OK  every frequently-used shop state key is in the backup');
