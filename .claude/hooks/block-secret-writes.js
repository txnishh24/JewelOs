let data = '';
process.stdin.on('data', c => data += c);
process.stdin.on('end', () => {
  let input;
  try { input = JSON.parse(data); } catch { return; }
  const file = (input.tool_input && input.tool_input.file_path) || '';
  if (/\.env(\..*)?$|\.pem$|credentials/i.test(file)) {
    console.log(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: `Blocked: ${file} matches a protected secret-file pattern (.env*, *.pem, credentials*)`
      }
    }));
  }
});
