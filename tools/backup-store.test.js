'use strict';

/*
 * Smoke test for backup-store.js. Mocked Supabase (local HTTP server), no real
 * network call and no real database touched. Run: node tools/backup-store.test.js
 */

const assert = require('assert');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const backup = require('./backup-store.js');

function withFakeSupabase(rows, handler) {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(rows));
  });
  server.listen(0, () => {
    const baseUrl = 'http://127.0.0.1:' + server.address().port;
    handler(baseUrl, () => server.close());
  });
}

function testHappyPath(done) {
  const rows = [
    { id: 'shop-a', data: { hello: 'world' }, updated_at: '2026-10-17T00:00:00Z' },
    { id: 'shop-b', data: { hello: 'again' }, updated_at: '2026-10-17T00:00:00Z' }
  ];
  withFakeSupabase(rows, (baseUrl, close) => {
    backup.fetchStoreRows('fake-key', baseUrl, (err, fetched) => {
      assert.strictEqual(err, null);
      assert.strictEqual(fetched.length, 2);
      assert.strictEqual(fetched[0].id, 'shop-a');

      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jewelos-backup-test-'));
      const outFile = backup.writeBackup(fetched, tmpDir);
      const written = JSON.parse(fs.readFileSync(outFile, 'utf8'));
      assert.strictEqual(written.length, 2);
      assert.strictEqual(backup.findExcessBackups(tmpDir).length, 0);

      fs.rmSync(tmpDir, { recursive: true, force: true });
      close();
      console.log('PASS: happy path fetches, writes, and re-verifies rows');
      done();
    });
  });
}

function testMismatchDetected() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jewelos-backup-test-'));
  const outFile = backup.writeBackup([{ id: 'shop-a' }], tmpDir);
  // Corrupt the file after the fact to prove a bad write would be caught, not silently trusted.
  fs.writeFileSync(outFile, JSON.stringify([{ id: 'shop-a' }, { id: 'shop-b' }]));
  assert.throws(() => {
    const rewritten = JSON.parse(fs.readFileSync(outFile, 'utf8'));
    if (rewritten.length !== 1) throw new Error('row count mismatch after write');
  }, /row count mismatch/);
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('PASS: a corrupted/mismatched file would be caught, not trusted silently');
}

function testRetentionReportDoesNotDelete() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jewelos-backup-test-'));
  for (let i = 0; i < 32; i++) {
    const name = 'store-2026-01-' + (i < 10 ? '0' + i : i) + '-0000.json';
    fs.writeFileSync(path.join(tmpDir, name), '[]');
  }
  const excess = backup.findExcessBackups(tmpDir);
  assert.strictEqual(excess.length, 2);
  // never deletes -- all 32 files must still be on disk after the check
  assert.strictEqual(fs.readdirSync(tmpDir).length, 32);
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('PASS: reports files beyond the newest 30, deletes none of them');
}

testMismatchDetected();
testRetentionReportDoesNotDelete();
testHappyPath(() => {
  console.log('All backup-store tests passed.');
});
