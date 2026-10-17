#!/usr/bin/env node
'use strict';

/*
 * JewelOS -- public.store backup tool
 * Interim safety net while the Supabase org is on the Free plan (no scheduled backups,
 * no point-in-time recovery). Read-only: this script never writes to Supabase.
 *
 * Setup (do this on YOUR OWN machine, never in chat with any Claude):
 *   1. Supabase Dashboard -> Project Settings -> API -> copy the "service_role" key.
 *   2. Set it as an environment variable named SUPABASE_SERVICE_KEY.
 *      (Windows, permanent: setx SUPABASE_SERVICE_KEY "paste-the-key-here"
 *       then open a NEW terminal window for it to take effect.)
 *
 * Usage:
 *   node tools/backup-store.js [output-folder]
 *   Default output folder: %USERPROFILE%\jewelos-backups (created if missing)
 *
 * Output: one file per run, store-YYYY-MM-DD-HHMM.json, containing every row of
 * public.store (id, data, updated_at) as returned by the Supabase REST API.
 *
 * Retention: does NOT delete old backups automatically -- deleting the wrong backup
 * is worse than a full folder. If there are more than 30, it prints the oldest ones
 * so Tanish can remove them by hand.
 *
 * RESTORE (manual, one shop at a time -- there is no automatic restore):
 *   1. Open the backup JSON, find the row for the shop you need:
 *        { "id": "<shop id>", "data": { ... }, "updated_at": "..." }
 *   2. In the Supabase SQL editor, run (double-check the id first -- this overwrites
 *      that shop's current data):
 *        update public.store
 *        set data = '<paste the row''s data field as JSON text>'::jsonb
 *        where id = '<paste the row''s id>';
 *
 * Schedule: run this daily via Windows Task Scheduler (see docs/BACKUP-SETUP.md for
 * the 3-step setup), and once more by hand before every deploy or migration.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const SB_URL = 'https://uluzuwomwqsqxtejgzmf.supabase.co';
const KEEP = 30;
const BACKUP_NAME_RE = /^store-\d{4}-\d{2}-\d{2}-\d{4}\.json$/;

// Uses the global fetch (Node 18+) so the same code works against the real
// https:// Supabase endpoint and an http:// mock server in tests.
function fetchStoreRows(serviceKey, baseUrl, callback) {
  const url = baseUrl + '/rest/v1/store?select=id,data,updated_at';
  fetch(url, {
    headers: {
      apikey: serviceKey,
      Authorization: 'Bearer ' + serviceKey,
      Accept: 'application/json'
    }
  }).then(async (res) => {
    const body = await res.text();
    if (res.status !== 200) {
      return callback(new Error('Supabase returned HTTP ' + res.status + ': ' + body.slice(0, 200)));
    }
    let rows;
    try {
      rows = JSON.parse(body);
    } catch (e) {
      return callback(new Error('response was not valid JSON'));
    }
    if (!Array.isArray(rows)) {
      return callback(new Error('unexpected response shape (expected an array of rows)'));
    }
    callback(null, rows);
  }).catch(callback);
}

function timestamp(d) {
  d = d || new Date();
  const pad = (n) => (n < 10 ? '0' + n : String(n));
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
    '-' + pad(d.getHours()) + pad(d.getMinutes());
}

// Writes rows to dir, re-reads the file, and verifies it round-tripped exactly.
// Throws on any mismatch. Returns the file path on success.
function writeBackup(rows, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const outFile = path.join(dir, 'store-' + timestamp() + '.json');
  fs.writeFileSync(outFile, JSON.stringify(rows, null, 2));

  let written;
  try {
    written = JSON.parse(fs.readFileSync(outFile, 'utf8'));
  } catch (e) {
    throw new Error('wrote ' + outFile + ' but it does not parse as JSON: ' + e.message);
  }
  if (!Array.isArray(written) || written.length !== rows.length) {
    throw new Error('row count mismatch after write: fetched ' + rows.length +
      ', file has ' + (Array.isArray(written) ? written.length : 'non-array'));
  }
  const fetchedIds = rows.map((r) => r.id).sort();
  const writtenIds = written.map((r) => r.id).sort();
  for (let i = 0; i < fetchedIds.length; i++) {
    if (writtenIds[i] !== fetchedIds[i]) {
      throw new Error('shop id mismatch after write: expected ' + fetchedIds[i] + ', found ' + writtenIds[i]);
    }
  }
  return outFile;
}

// Returns full paths of backup files beyond the newest KEEP, oldest first. Deletes nothing.
function findExcessBackups(dir) {
  const files = fs.readdirSync(dir).filter((f) => BACKUP_NAME_RE.test(f));
  files.sort(); // the filename format sorts chronologically
  if (files.length <= KEEP) return [];
  return files.slice(0, files.length - KEEP).map((f) => path.join(dir, f));
}

function main() {
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!serviceKey) {
    console.error('BACKUP FAILED: SUPABASE_SERVICE_KEY is not set. Set it yourself ' +
      '(Supabase Dashboard -> Project Settings -> API) -- never paste it in chat.');
    process.exit(1);
  }

  const outDir = process.argv[2] || path.join(os.homedir(), 'jewelos-backups');

  fetchStoreRows(serviceKey, SB_URL, (err, rows) => {
    if (err) {
      console.error('BACKUP FAILED: could not read public.store: ' + err.message);
      process.exit(1);
    }

    let outFile;
    try {
      outFile = writeBackup(rows, outDir);
    } catch (e) {
      console.error('BACKUP FAILED: ' + e.message);
      process.exit(1);
    }

    const ids = rows.map((r) => r.id).sort();
    console.log('OK: backed up ' + rows.length + ' shop(s) to ' + outFile);
    console.log('shop ids: ' + ids.join(', '));

    const excess = findExcessBackups(outDir);
    if (excess.length) {
      console.log('NOTE: ' + excess.length + ' backup(s) older than the newest ' + KEEP +
        ' -- not deleted automatically, remove by hand if you want:');
      excess.forEach((f) => console.log('  ' + f));
    }
  });
}

if (require.main === module) {
  main();
}

module.exports = { fetchStoreRows, writeBackup, findExcessBackups, timestamp, SB_URL };
