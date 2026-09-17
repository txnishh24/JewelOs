# batch20 — the making charge actually reaches the bill

Base: batch19 (built 14 Sep; **check it is actually live before dragging this in** — if
batch19 was never deployed, this zip supersedes it and contains everything from it too,
since both were built from the same repo).

This batch fixes five of the nine bugs from the 17 Sep live walkthrough. One of them
changes what customers are charged, so read section 1 before you demo.

---

## 1. ⚠️ A product's making charge is now actually charged

**Read this one properly — it changes bill totals.**

**Before:** you set "Making Charge ₹/g" on a product, sold it through the SKU/name picker,
and the making charge never appeared on the bill. "Extra making ₹" stayed 0. The customer
was charged for the metal only.

Worse, the profit figure counted that same making charge as a **cost**. So on a product
with no Purchase Rate filled in, a sale showed a **loss** of exactly the making charge —
an 8.5g bangle at ₹500/g reported **−₹4,250** on a day it should have reported **+₹4,250**.

**Now:** the making charge is added to the bill, and is no longer subtracted as a cost.

**What this means for you in practice:**

- **Bills for products with a making charge will be higher than they were yesterday.**
  That is the correct amount — it is what you told the app to charge — but if you have been
  quoting customers from the old (wrong) totals, your quotes will now be short.
- **Today's Profit will jump** for those items. That is the loss being corrected, not new money.
- **Invoices already issued are untouched.** Their totals are locked and will not move, even
  though the product they were sold from now has a live making charge. An old bill shows what
  the customer actually paid.

**Still to do (small, not in this zip):** there is no Making Charge field on the *Edit
Product* form, only on Add. So a wrong rate cannot be corrected without deleting and
re-adding the item. Worth fixing before you rely on this heavily.

## 2. The blank grey box over the dashboard is gone

**Before:** about a second after signing in, a dark empty panel covered the dashboard. It had
no text, no buttons and no way to close it — Escape did nothing. It happened on every fresh
login: new signup, staff login, owner re-login.

**Now:** removed. The onboarding **checklist** on the dashboard (set rates → add a product →
record a sale → change your PIN) is the real first-run guide, and it was sitting underneath
that panel the whole time.

## 3. Cloud Setup no longer says "Checking…" forever

**Before:** Settings → Data showed a "⚪ Checking..." badge that never changed, on every visit.

**Now:** it reports the real state — "Connected", or when the last sync was. Two other fields
on that screen were blank for the same underlying reason and now fill in correctly: the
**digest email** and the **Razorpay key** both showed empty no matter what you had saved.

## 4. Cloud Diagnostics stops contradicting itself

**Before:** running Cloud Diagnostics printed "auth-gateway: UNREACHABLE" and then, two lines
later, "Authentication: Healthy" — while sign-in was working perfectly. The check itself was
malformed; nothing was actually wrong with the server.

**Now:** the check asks the server the same way the app does, and the summary line reflects
what the checks found instead of always claiming everything is healthy.

## 5. Smaller things

- **A loss is now shown in red.** "Today's Profit" was green whether the number was positive or
  negative, so a loss looked like a gain at a glance.
- **The sign-in footer** said "© 2025". It now shows the current year.
- **New shops no longer get "What's New in v18.1"** on their first login — release notes for a
  version they never used. Related: on a shared device, a second shop now gets its own
  first-run screens instead of inheriting the first shop's.

---

## What is NOT in this zip

- **The password-reset logging fix is server-side** and goes live through Supabase, not here.
  It does not depend on this zip and this zip does not depend on it.
- **The floating "Build your own site with Netlify" badge** is not part of JewelOS. It comes
  from the free `*.netlify.app` subdomain and disappears with a custom domain.
- **The team roster is still deliberately not in the JSON backup.** That was reviewed and left
  as it is on purpose; reasoning is in the code and in `HANDOFF.md`.

## After you deploy — worth five minutes

1. **Make a product with a making charge** (say ₹500/g on a 10g item), sell it through the
   SKU picker, and check "Extra making" shows ₹5,000 and the bill total includes it.
2. **Open an invoice printed before today** and confirm its total has not changed.
3. **Sign out and back in.** The dashboard should come up clean — no blank panel to dismiss.
4. **Settings → Data:** the Cloud Setup badge should leave "Checking…". Check your digest
   email and Razorpay key show the values you saved.
5. **Run Cloud Diagnostics** and confirm it no longer reports auth as unreachable.
6. Check the sign-in footer reads the current year.

## Verified before shipping

Regression suite 87/87, all nine static checks at the batch19 baseline, every file parses,
and the zip was extracted and compared file-by-file against the repo. Entry paths were checked
to use `/` separators, which is what broke the batch17 deploy twice.

**Not verified:** anything needing a real phone, a real signed-in session, or two accounts on
one device. There is no automated UI testing here — the logic is tested, the screens are not.
