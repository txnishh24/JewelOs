# Setting up the daily store backup (Tanish)

This gives you a safety copy of every shop's data each day, since Supabase
Free doesn't keep backups for you. It only reads data, never changes anything.

## Step 1 — set your service key (one time, on your own computer)

1. Go to the Supabase Dashboard → your project → **Project Settings → API**.
2. Copy the key labeled **service_role** (not the "anon" one).
3. Open Command Prompt and run (replace the placeholder with the real key):
   ```
   setx SUPABASE_SERVICE_KEY "paste-the-key-here"
   ```
4. Close that Command Prompt window. Open a **new** one for it to take effect.

Never paste this key into a chat with Claude Code or Cowork — it can read and
change every shop's data, so it only ever lives on your own machine.

## Step 2 — try it once by hand

In the new Command Prompt, go to the JewelOS folder and run:
```
node tools/backup-store.js
```
You should see `OK: backed up N shop(s) to ...`. The file lands in
`C:\Users\<you>\jewelos-backups\` by default.

## Step 3 — make it run automatically every day

1. Open **Task Scheduler** (search for it in the Start menu) → **Create Basic Task**.
2. Name it "JewelOS backup", choose **Daily**, pick a time (e.g. 3 AM).
3. For the action, choose **Start a program**:
   - Program/script: `node`
   - Arguments: `tools/backup-store.js`
   - Start in: the full path to your JewelOS folder (e.g. `C:\Users\you\Desktop\jewelos`)
4. Finish. That's it — it now runs daily without you doing anything.

## Also run it by hand before any deploy or database migration

Same command as Step 2: `node tools/backup-store.js`. Takes a few seconds.

## If something looks wrong

The script prints a line starting with `BACKUP FAILED:` and exits with an
error if anything went wrong — it never silently writes a bad or partial file.
If you see that, nothing was lost; just re-run it.

If your `jewelos-backups` folder ever has more than 30 files, the script
prints which ones are the oldest. It never deletes anything by itself — you
can remove them by hand if you want to clean up.
