#!/usr/bin/env node
// PostToolUse hook (Edit|MultiEdit|Write): after any change to a top-level js/
// module, syntax-check it and re-run the regression suite immediately, instead
// of waiting for someone to double-click check.bat. The suite already contains
// the scan for unscoped localStorage keys (tests/README.md) — this hook does
// not duplicate that logic, it just runs it sooner.
var path = require('path');
var cp = require('child_process');

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
