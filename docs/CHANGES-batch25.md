# batch25 — the button-color fix you asked for, but this zip is bigger than that

Base: batch24 (Girvi Archive button, deployed live and confirmed). This is a full site zip,
so it contains everything since then — which turned out to be more than the one-line fix
this batch was originally scoped for. Read "What's actually in this zip" before dragging it
into Netlify.

## The task this batch was built for

**The Archive confirm dialog no longer renders red.** `deleteGirviEntry` was calling
`safeConfirm(..., true)` — the trailing `true` is the `danger` flag, which forces the red
"this is destructive" styling even though archiving isn't destructive (it's fully
recoverable via "↺ Recover"). Dropped the flag; the dialog now renders amber/gold like every
other non-destructive confirm in the app. This was already fixed in the code on 19 Sep — it
just never got zipped until now.

## What's actually in this zip (read this part)

Time passed between "fix the button color" being asked for and this zip actually getting
built, and a lot happened on this folder in between:

- **Two dead functions removed** (`saasHashPassword`, `saasVerifyPassword`) — unused
  password-hashing code, confirmed to have zero callers anywhere. No behavior change; nothing
  to test.
- **A whole new feature: the Day Book (rojmel) tab.** Cash-in/cash-out tracking, Close Day,
  print and WhatsApp sharing, a new field on Girvi loan creation. This is real, working code
  with 168 passing regression tests — but **it has never been opened in a browser or tapped
  on a phone.** Nobody has verified the tab renders, a modal opens, or Close Day actually
  works on a screen.

**If you only wanted the button-color fix, you now have to choose:** deploy this zip and get
Day Book along with it (untested, but present and reachable from the tab bar), or wait for
someone to tap through Day Book first before this goes live. That choice is not mine to make
— flagging it instead of deciding it for you.

## After you deploy — one minute (for the part that IS verified)

1. Open Girvi, archive any active (non-closed) loan.
2. The confirmation dialog should be amber/gold, not red.
3. Confirm archiving still works exactly as before (loan moves to Archived, Recover brings it
   back unchanged).

## If you deploy Day Book too

See the Day Book HANDOFF entries (20 Sep, batches A–G) for what to actually tap through:
set an opening balance, add and void an expense, close a day, correct a count, print, share
to WhatsApp. None of that has been done by anyone yet.

## Verified before shipping

Regression suite 168/168, all eleven files parse, zip built with 7-Zip (not
Compress-Archive — see `build-deploy-zip.js`'s own header for why that matters), every stored
path uses `/`, and the extracted zip byte-matches this folder file-for-file.

**Not verified:** the Day Book tab, on any screen, by anyone. The button-color fix itself was
already verified working before this zip existed — only the packaging was outstanding.
