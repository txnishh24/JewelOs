#!/usr/bin/env node
// Stop hook: CLAUDE.md routes every js/ change to jewelos-bug-pattern-reviewer,
// then jewelos-test-runner, but a rule in prose is only followed when the session
// remembers it. This blocks the end of a turn if a top-level js/ module was
// edited and either agent has not run since that last edit, and tells Claude
// which ones to run. It reads the session transcript; it does not run the
// agents itself (hooks cannot spawn subagents).
var fs = require('fs');
var path = require('path');

var NEEDED = ['jewelos-bug-pattern-reviewer', 'jewelos-test-runner'];

var input = '';
process.stdin.on('data', function (d) { input += d; });
process.stdin.on('end', function () {
  var data;
  try { data = JSON.parse(input); } catch (e) { process.exit(0); }

  // Already blocked once this turn — let it stop rather than loop forever.
  if (data.stop_hook_active) process.exit(0);

  var cwd = data.cwd || process.cwd();
  var lines;
  try { lines = fs.readFileSync(data.transcript_path, 'utf8').split('\n'); }
  catch (e) { process.exit(0); } // no transcript — skip rather than block on infra

  var lastEdit = -1;
  var lastRun = {};
  NEEDED.forEach(function (n) { lastRun[n] = -1; });

  lines.forEach(function (line, i) {
    if (!line) return;
    var msg;
    try { msg = JSON.parse(line); } catch (e) { return; }
    var content = msg.message && msg.message.content;
    if (!Array.isArray(content)) return;
    content.forEach(function (c) {
      if (!c || c.type !== 'tool_use') return;
      var inp = c.input || {};
      if (/^(Edit|MultiEdit|Write)$/.test(c.name) && inp.file_path) {
        var rel = path.relative(cwd, inp.file_path).replace(/\\/g, '/');
        if (/^js\/[^/]+\.js$/.test(rel)) lastEdit = i;
      } else if ((c.name === 'Agent' || c.name === 'Task') && inp.subagent_type) {
        NEEDED.forEach(function (n) {
          if (String(inp.subagent_type).indexOf(n) !== -1) lastRun[n] = i;
        });
      }
    });
  });

  if (lastEdit < 0) process.exit(0);
  var missing = NEEDED.filter(function (n) { return lastRun[n] < lastEdit; });
  if (!missing.length) process.exit(0);

  process.stdout.write(JSON.stringify({
    decision: 'block',
    reason: 'js/ was edited and these agents have not run since: ' + missing.join(', ') +
      '. CLAUDE.md requires them after any js/ change (reviewer first, then test-runner). ' +
      'Run them now, report their findings, then finish. Skip only if the edit was trivial ' +
      '(comment/whitespace) and say so.'
  }));
  process.exit(0);
});
