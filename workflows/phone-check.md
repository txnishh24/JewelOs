# Workflow: phone check on shop `3720af09`

## Objective
Tanish checks the build on a real phone, in his own empty shop `3720af09`. Claude cannot do this; it prepares the list and records the answers.

## Inputs
- The build number just deployed (`APP_BUILD`, shown in the footer or Settings).
- Tanish's phone, his login for `3720af09` and a manager login for item 6 (never written down here).

## Steps (Tanish ticks each; Claude puts the list in the HANDOFF `→ FOR TANISH` line)
1. Open the app, wait for it to update, close and reopen once if needed. The footer or Settings shows the **build number** you expect.
2. Karigars: open a profile, go Home, come back. **Back to profile** works after the Home round trip.
3. **New job** with a weight entered: saves, and the weight shows right.
4. **Close sheet**: the labour preview shows before you confirm.
5. **Give advance** with the iOS keyboard open: the Save button is not hidden behind the keyboard.
6. Log in as **manager**: no rupee amounts for karigars (no labour, salary, advance), no cost price.
7. **Bill Preview** is full width (not squeezed to the left), one WhatsApp button, invoice not clipped.
8. **Split payment**: the amount box shows a 6-digit amount without clipping.
9. Anything odd: screenshot it and write what you tapped.

## Expected output
A tick or a note per item, written by Tanish or relayed to Claude, then recorded in HANDOFF with the build number and date.

## Edge cases and failure handling
- The page looks old: close the app fully and reopen (the service worker cache `jewelos-vNN` updates on the next visit; a reload or two may be needed).
- An item fails: log it with the build number; do not fix on the live shop. Open a review round (`workflows/review-round.md`).
- Do not create real sales or customers; `3720af09` is empty on purpose (it holds 12 Girvi loans and no sales).

## Learned
(empty)

## Stop conditions needing Tanish's word
Using any other shop, adding real customer data, turning any feature switch on his phone.

## Safety (same block in every workflow; do not weaken)
- **Never put a secret, API key or credential value** in a report, committed file or HANDOFF.md — name the variable, not the value.
- **Deploy only when Tanish says so.** Never run `/ship`, `/land-and-deploy` or `/canary`.
- No migration, deploy or key rotation without Tanish's explicit word.
- Never test on a real shop: a local build or E2E test shop `77c4aefe` only (`3720af09` is Tanish's own empty shop, phone checks only; `65a3ce29` is production, untouched).
- Delete nothing without Tanish's say.
- Ledger flag `kgLedgerOn` stays OFF.
- No dark mode yet.
