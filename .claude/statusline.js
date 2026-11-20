#!/usr/bin/env node
// Status line: branch + context percent. Compact near 60%, clear between tasks (CLAUDE.md).
var cp = require('child_process');
var input = '';
process.stdin.on('data', function (d) { input += d; });
process.stdin.on('end', function () {
  var data = {};
  try { data = JSON.parse(input); } catch (e) {}
  var dir = (data.workspace && data.workspace.current_dir) || data.cwd || process.cwd();
  var b = cp.spawnSync('git', ['branch', '--show-current'], { cwd: dir, encoding: 'utf8' });
  var branch = (b.status === 0 && b.stdout.trim()) || 'no-branch';
  var cw = data.context_window || {};
  var pct = cw.used_percentage;
  if (typeof pct !== 'number' && cw.context_window_size && cw.total_input_tokens) {
    pct = cw.total_input_tokens / cw.context_window_size * 100;
  }
  var ctx = typeof pct === 'number' ? 'ctx ' + Math.round(pct) + '%' + (pct >= 60 ? ' COMPACT' : '') : 'ctx ?';
  process.stdout.write(branch + ' | ' + ctx);
});
