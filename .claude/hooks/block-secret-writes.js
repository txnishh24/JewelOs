// PreToolUse guard: refuses to let Claude write to .env*, *.pem, or
// credentials* files — backs up the permissions.deny entries in settings.json
// for any tool whose matcher reaches this script.
//
// Two gaps closed 10 Oct (Phase 5, both independently flagged by the same
// Sep security pass as this hook's own earlier version):
// 1. Fails CLOSED now, not open. A malformed/unparseable stdin payload used
//    to `return` with no output at all -- which this harness reads as "no
//    objection," i.e. the write goes through unblocked. A security gate must
//    refuse when it can't tell what's happening, not silently step aside.
//    This WILL occasionally deny a legitimate Write/Edit if the hook's own
//    input is ever malformed (should be rare -- the harness constructs it) --
//    that's the intended trade, a blocked edit is recoverable, a missed
//    secret write is not.
// 2. Covers the Bash tool. The file_path check only ever fired for Write/Edit
//    (the settings.json matcher this hook is registered under); a Bash call
//    like `cp secret.env .env` or `echo KEY=x >> .env` never had file_path at
//    all and sailed through untouched. Bash commands are free text, not a
//    clean path, so this can't be as precise as the file_path check -- it's
//    deliberately conservative (over-block, don't under-block): ANY secret-
//    pattern substring plus ANY write-shaped token anywhere in the command
//    denies the whole call, with no attempt at real shell parsing.
//    Known gaps, on purpose rather than by oversight: a target built from a
//    shell variable (`echo x > $F`), heredoc redirection split across lines
//    in a way the single-line scan misses, or any command run through `sh -c`
//    /`bash -c` with the dangerous part double-quoted inside another string.
//    This is a backstop, not a sandbox -- it catches the common, literal case.
const SECRET_RE = /\.env(\.[\w-]+)?\b|\.pem\b|credentials/i;
const WRITE_TOKEN_RE = /(>>?|<<|\bcp\b|\bmv\b|\btee\b|\bdd\b|\brsync\b|\binstall\b)/;

function deny(reason) {
  console.log(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason
    }
  }));
}

let data = '';
process.stdin.on('data', c => data += c);
process.stdin.on('end', () => {
  let input;
  try {
    input = JSON.parse(data);
  } catch (e) {
    deny('Blocked: this hook could not parse its own input (' + e.message + ') -- failing closed rather than letting an unverifiable write through.');
    return;
  }

  const toolInput = input.tool_input || {};

  const filePath = toolInput.file_path || '';
  if (filePath && SECRET_RE.test(filePath)) {
    deny(`Blocked: ${filePath} matches a protected secret-file pattern (.env*, *.pem, credentials*)`);
    return;
  }

  const command = toolInput.command || '';
  if (command && SECRET_RE.test(command) && WRITE_TOKEN_RE.test(command)) {
    deny(`Blocked: this command looks like it writes to a protected secret-file pattern (.env*, *.pem, credentials*): ${command}`);
    return;
  }
});
