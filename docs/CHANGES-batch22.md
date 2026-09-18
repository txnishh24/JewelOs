# batch22 — two places where the app disagreed with reality

Base: batch21 (deployed and re-tested live on 18 Sep). This is a full site zip, so it
contains everything batch21 had as well — dragging it in is safe either way.

Both fixes are about the app showing something that isn't true. **No bill, payment or
interest figure changes** — only what the edit form accepts, and what date the Girvi
screens print.

---

## 1. Sold-out items can be edited again

**Before:** once an item sold out, Edit Product refused to save *any* change — even just
correcting its making charge. You pressed Save, the window stayed open, and the change was
gone next time you looked. A small "Gross weight required" message flashed at the bottom of
the screen for about three seconds, easy to miss, about a box you never touched.

**Now:** a sold-out item opens with its real weight filled in, and saves normally. A note
under the weight says *"Sold out — this is kept for when you restock"*.

### The bigger problem this was hiding

Correcting a product's weight used to be **quietly undone later**. You'd fix an item from 5g
to 6g, and the next time a piece of it sold, JewelOS worked the weight out again from the
*old* figure — so the correction just disappeared. On a batch of three, correcting to 6g per
piece and then selling one showed **10g left instead of 12g**.

That's fixed too. Corrections now stick.

### What you'll see

- The weight box is now labelled **"(one piece)"**. For a single item — which is most jewellery
  — this changes nothing: one piece *is* the whole weight.
- For a **batch** (several identical pieces from one purchase bill), the box shows the weight of
  one piece, with a note underneath: *"3 pieces in stock · 15 g total"*.
- If you do leave the weight empty, the message now says **"Enter the weight of one piece"** and
  puts your cursor in the box, instead of a message about something you didn't touch.

## 2. Girvi screens show the date a payment was actually made

**Before:** if you recorded a payment late — say the customer paid on 8 August and you entered
it on 18 September — the Girvi Ledger showed **18 September**. It showed the payment twice, and
both lines had the wrong date. The same thing happened on the loan's Timeline and in its
history.

**The money was always right.** Interest was worked out from 8 August all along; only the date
printed on screen was wrong. But that's the record you'd show a customer, and it was wrong on
exactly the entries where the real date mattered.

**Now:** every Girvi screen shows the date the payment was made. That includes **payments you've
already recorded** — nothing needs re-entering. Payment dates also no longer show a made-up time
of day, since you only ever entered a date.

---

## What is NOT in this zip

- **Nothing server-side.** No Supabase change.
- **Password reset is still switched off on purpose** until `RESEND_API_KEY` is set in Supabase.
  "Forgot password" answers "Password reset is unavailable right now" until then.
- **The "Free forever · No credit card needed" wording on the sign-up screen** is still there. It
  contradicts the paid subscription and is the first thing a new shop reads — flagged, but it's a
  wording decision for you rather than a bug fix.

## After you deploy — three minutes

1. **Find a sold-out item → Edit.** The weight box should have a number in it, not be empty.
   Change the making charge and press Save. **The window should close and the change should stay.**
2. **Weight correction sticks:** pick an item with more than one piece in stock. Note the
   per-piece weight shown, correct it, save, then sell one piece. The weight left should be the
   *corrected* per-piece weight × pieces remaining.
3. **Girvi date:** open a loan with a payment you entered on a later day than it was made. Both
   payment lines in its Ledger should show **the day it was paid**, not the day you typed it in.
4. **Nothing else moved:** open a recent invoice and a girvi balance you know. The amounts must be
   exactly what they were.

## Verified before shipping

Regression suite 113/113, all nine static checks clean, every file parses, and the zip was
extracted and compared file by file against the source. Paths checked to use `/` separators.
Both fixes were also run in a real browser against the exact situations reported.

**Not verified:** anything needing a real phone or a real signed-in session. Both fixes were
tested by running the real code in a desktop browser, not by tapping through the live app.
