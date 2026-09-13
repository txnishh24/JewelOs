# batch19 — sign-out that actually signs out, and escaped shop text

Base: batch18 (deployed; re-tested live by Cowork on 12 Sep). This batch fixes the
client half of the 14 Sep security review — findings 2, 3 and 9 in
`docs/SECURITY-REVIEW-2026-09-14.md` — plus one non-security bug found while testing.

**This zip is independent of the server fixes.** It works with the Edge Functions
currently live and with the fixed ones waiting to be deployed, in either order. See
"Server side" below.

---

## 1. Signing out leaves nothing behind

**Before:** "Sign out" hid the app behind the sign-in screen, but left a full copy of the
shop on the phone (`ssj_cache` — customers, phone numbers, girvi loans, sales, photos),
kept the session token, and kept the shop in memory.

**Now:** every sign-out removes the saved login, the session token, the cached user and
shop records, and the shop copy, then **reloads the page** — which is what actually empties
memory and stops the background sync timer. PIN settings stay: they belong to the
device, not the shop.

**If a save hasn't reached the cloud yet,** the "Sign out?" question now says so, with a red
confirm button, because signing out deletes this device's copy — and with it the only copy
of that change. (In practice the app already overwrote unsynced local changes with the
cloud copy the next time it started online; this makes the risk visible instead of silent.)

## 2. A rejected session signs out immediately — no Cancel button

**Before:** when the server rejected a session (expired, or — once the fixed `store-proxy`
is deployed — a staff member who has been removed), the app called the normal sign-out,
which asks "Sign out?". Tapping Cancel left the person in the app, able to browse the whole
shop from the cached copy.

**Now:** a rejected session signs out at once, with no question, and the sign-in screen
explains why ("Your session has ended — please sign in again."). Same for a new staff
member who closes the forced "set a new password" screen: that also used to allow Cancel,
contrary to what the code said it guaranteed.

**One visible change for real users:** if a session expires in the middle of a save, the
screen reloads to sign-in. Whatever they were typing is gone, and the message asks them to
redo their last change. Before, the "unsaved changes are still on screen" promise only held
until they signed in again, when the cloud copy replaced them anyway.

## 3. Typed text can no longer run as code

Text people type was placed into the page as raw HTML in several places. Anyone who could
type `<img src=x onerror=...>` could run code in the owner's browser and take over their
session. Now escaped, so it shows as plain text:

| Field | Where it was raw |
|---|---|
| **Shop name, city, phone, GSTIN** (a manager can edit these) | every sale invoice, order receipt, stock labels, monthly report |
| Girvi pledged-item description | girvi loan cards, today's actions, girvi receipt |
| Order item description and note | order detail, orders dashboard, printed order receipt |
| Order payment reference, note and mode | order detail, printed order receipt |
| Activity log type, note and user | Settings → activity log (both places it renders) |

Escaping is applied where the text enters HTML, not where it's stored. The shop name also
goes into WhatsApp messages, which are plain text, so escaping it at the source would have
put `&amp;` in customers' messages.

**Not in this batch:** the review counted 611 unescaped values in total. The ones fixed here
are the ones reachable by typing into the app. The rest — dropdown values, record ids,
photo data — can only be abused by someone writing directly to the server with devtools,
and are the next batch.

## 4. Order receipts no longer say "Sri Sai Jewellers" for every shop

The printed order receipt's header was hard-coded to **Sri Sai Jewellers** — every shop's
customers would have received a receipt with another shop's name on it. It now shows the
signed-in shop's name. (Found while checking the escaping in a browser.)

---

## Server side (not in this zip — Cowork deploys)

`auth-gateway` now refuses `<` and `>` in shop name, city, phone, GSTIN and people's names
(signup, update-shop, add-staff). No real name needs them, and it protects every screen that
shows those fields, including any the client ever forgets to escape. Shop names with `&` and
apostrophes are still accepted. This joins the two fixes from earlier today (reset-code guess
limit, removed-staff cut-off) in the `auth-gateway` / `store-proxy` deploy described in
`HANDOFF.md`.

## Verified

- **Regression suite 66/66**, including 11 new tests. Run against the batch18 code, all 11
  fail — they catch exactly these bugs.
- **Edge Function tests 20/20**, including 3 new ones for the `<`/`>` guard, which fail
  against the previous `auth-gateway`.
- **All nine checks at the batch18 baseline.** The only differences are line numbers moved
  by the added lines, plus one extra element lookup that points at an element that exists.
  `backup-check` and `roundtrip` clean. All ten files parse.
- **In a real browser** (local copy, nothing sent to the live site):
  - A signed-in device receiving a rejected session reloaded with no question, kept none of
    the shop's data or the token, and showed the reason once.
  - "Sign out?" with an unsynced save showed the warning; Cancel kept everything; a synced
    device got the plain question, and confirming cleared the device.
  - A hostile payload in every field in the table above displayed as plain text on the
    girvi card, order receipt and invoice. It never ran, and no image element was created.
  - Real shop details with `&` render correctly (no `&amp;`), and the receipt header shows
    the shop's own name.

## Not verified

- **A real Android phone.** In particular the reload after sign-out in the installed app.
- **A real expired or removed session against the live server.** The 401 was simulated
  in the browser. The removed-staff case only happens once the fixed `store-proxy` is live.
- **The activity log and today's-girvi-actions screens** were not opened in a browser;
  those two fixes are covered by the tests and a code read only.

## Re-test on `lumineer` after deploying

1. Sign out from Settings. Sign back in. Everything loads from the cloud as normal.
2. In Chrome devtools → Application → Local Storage after signing out: no `ssj_cache`, no
   `jewelos_session`.
3. Type `<b>test</b>` into a girvi item description and an order payment reference. It
   should show as literal `<b>test</b>`, not bold text.
4. Print an order receipt: the header shows `lumineer`'s name, not Sri Sai Jewellers.

## Found, not fixed

**Every printed invoice shows "₹₹" — seen on the grand total and balance due.**
`js/02-ui-inactivity-modals.js` writes `&#8377;` in front of `fmt()`, which already starts
with ₹, in three places. It predates this batch; a one-line-each fix for the next one.
