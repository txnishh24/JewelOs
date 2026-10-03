#!/usr/bin/env node
// PostToolUse hook (Edit|MultiEdit|Write): after any change to a top-level js/
// module, syntax-check it and re-run the regression suite immediately, instead
// of waiting for someone to double-click check.bat. The suite already contains
// the scan for unscoped localStorage keys (tests/README.md) — this hook does
// not duplicate that logic, it just runs it sooner.
var path = require('path');
var fs = require('fs');
var cp = require('child_process');

// ES5-only house rule (CLAUDE.md): parsing at ecmaVersion 5 rejects arrow
// functions, let/const, template literals, async/await, etc. for free —
// no regex over comments/strings needed, acorn already ignores those.
function es5Parses(src, acorn) {
  try { acorn.parse(src, { ecmaVersion: 5 }); return true; }
  catch (e) { return e.message; }
}

// Only flag a violation this edit actually introduced. A few pre-existing
// lines in the codebase already aren't ES5 (found when this check was added,
// Oct 2026: a \u{...} escape and a real async function) — blocking every
// future unrelated edit to those files over old debt would be useless noise.
function es5Violation(filePath, rel, cwd) {
  var acorn;
  try { acorn = require(path.join(cwd, 'checks', 'node_modules', 'acorn')); }
  catch (e) { return null; } // acorn missing — skip rather than block on infra
  var src;
  try { src = fs.readFileSync(filePath, 'utf8'); } catch (e) { return null; }
  var nowMsg = es5Parses(src, acorn);
  if (nowMsg === true) return null;

  var head = cp.spawnSync('git', ['show', 'HEAD:' + rel], { cwd: cwd, encoding: 'utf8' });
  if (head.status === 0 && es5Parses(head.stdout, acorn) !== true) {
    return null; // already broken at HEAD — pre-existing debt, not this edit
  }
  return nowMsg;
}

var input = '';
process.stdin.on('data', function (d) { input += d; });
process.stdin.on('end', function () {
  var data;
  try { data = JSON.parse(input); } catch (e) { process.exit(0); }

  var toolInput = data.tool_input || {};
  var filePath = toolInput.file_path;
  if (!filePath) process.exit(0);

  var cwd = data.cwd || process.cwd();
  var rel = path.relative(cwd, filePath).replace(/\\/g, '/');

  // Only the ten numbered top-level modules — never checks/, tests/, or nested paths.
  if (!/^js\/[^/]+\.js$/.test(rel)) process.exit(0);

  var problems = [];

  var chk = cp.spawnSync(process.execPath, ['--check', filePath], { cwd: cwd, encoding: 'utf8' });
  if (chk.status !== 0) {
    problems.push('node --check failed on ' + rel + ':\n' + (chk.stderr || chk.stdout || ''));
  }

  var es5msg = es5Violation(filePath, rel, cwd);
  if (es5msg) {
    problems.push(rel + ' is not ES5 — house rule in CLAUDE.md is ES5 only ' +
      '(no arrow functions, let/const, template literals, async/await):\n' + es5msg);
  }

  var test = cp.spawnSync(process.execPath, ['tests/regression.test.js'], { cwd: cwd, encoding: 'utf8' });
  if (test.status !== 0) {
    problems.push('regression suite failed after editing ' + rel + ' — do not hand back this build until it is green again:\n' + (test.stdout || '') + (test.stderr || ''));
  }

  if (problems.length) {
    process.stderr.write(problems.join('\n\n') + '\n');
    process.exit(2);
  }
  process.exit(0);
});
