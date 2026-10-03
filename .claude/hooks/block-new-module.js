#!/usr/bin/env node
// PreToolUse hook (Write): CLAUDE.md says not to create another top-level
// js/ module file without the same justification 10-daybook.js needed AND
// Tanish's explicit sign-off — "not a standing permission". Blocks a Write
// to a new js/<number>-*.js path; editing an existing one is unaffected.
var fs = require('fs');
var path = require('path');

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

  if (!/^js\/\d+-[^/]+\.js$/.test(rel)) process.exit(0);

  if (fs.existsSync(filePath)) process.exit(0); // editing an existing module is fine

  process.stderr.write(
    'Blocked: ' + rel + ' would be a new top-level js/ module.\n' +
    'CLAUDE.md: "Do not create another new module file without the same ' +
    'justification 10-daybook.js needed and Tanish\'s explicit sign-off ' +
    '- this was an exception made once, not a standing permission."\n' +
    'Ask Tanish before creating this file; otherwise add the code to an existing module.\n'
  );
  process.exit(2);
});
