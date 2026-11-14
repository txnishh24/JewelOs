// ══════════════════════════════════════════════════════════════════════
// role-check.ts: what a manager or staff PUT may change in the shop blob (R29).
//
// PURE: no Deno, no Supabase, no network. Imported by index.ts and by
// tests/role-check.test.mjs (Node runs it directly; keep the types erasable:
// no enums, no parameter properties).
//
// checkRoleWrite(role, cur, next) returns null (allowed) or {code, message}
// (first violation, message in plain words for the shop owner's staff).
// Owner always passes. `cur` is the stored blob, `next` is the blob being
// written. The caller only runs this when the client's expectedVersion equals
// the stored version, so `cur` is what the client saw.
//
// Mirrors the client rules of R26-R28 (js/05-auth-login.js discountProblem,
// js/03-billing-numbers.js deleteSale, js/10-daybook.js dbReopenDay). A false
// refusal means a legitimate sale cannot be saved, so every rule below errs
// toward ALLOWING anything the real client produces; see
// docs/ROLE-CHECK-DESIGN.md for the known gaps.
// ══════════════════════════════════════════════════════════════════════

export type Violation = { code: string; message: string };

// A non-owner save may not shrink a list by more than this share in one save
// (guards "Clear All" typed into the browser console). Lists under
// SHRINK_MIN_LEN records are not checked: a shop with 3 products may delete 1.
export const SHRINK_MAX_FRACTION = 0.2;
export const SHRINK_MIN_LEN = 5;
export const SHRINK_LISTS = ["customers", "products", "girvi", "orders", "purchases"];
// Tanish, 14 Nov 2026: no bill after the day is closed, for staff or manager; the owner reopens the day first.
// The client refuses it too (recordSale). Known edge: an offline bill made before the close and synced after it
// is refused here; the phone sets it aside (quarantineOfflineSales) and the owner must reopen the day.
export const BLOCK_NEW_SALE_ON_CLOSED_DAY = true;
export const DEFAULT_DISC_CAPS = { staff: 5, manager: 15 };
// The percent the client shows is rounded; allow this much slack so a bill the
// client accepted at exactly the cap is never refused here.
export const DISC_PCT_SLACK = 0.1;
// Keys that live in auth_store (shop plan, users) and must never come from a blob.
export const PROTECTED_KEYS = ["plan", "gstin", "kgLedgerOn", "paidUntil", "users", "team", "shop"];
// An existing bill may change these (a payment is recorded against it), for staff too.
const PAYMENT_KEYS = ["extraPayments", "paymentHistory", "payStatus", "paidAt"];
const REFUND_KEYS = ["refunds", "refundStatus", "returnedItemIdx"];
// India Standard Time: shops are in India and the client's day key is the phone's local day.
const IST_MS = 330 * 60000;

const bad = (code: string, message: string): Violation => ({ code, message });

export function deepEq(a: any, b: any): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a == b;   // undefined and null count as the same "empty"
  if (typeof a !== typeof b) return false;
  if (typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEq(a[i], b[i])) return false;
    return true;
  }
  const ka = Object.keys(a).filter((k) => a[k] !== undefined);
  const kb = Object.keys(b).filter((k) => b[k] !== undefined);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (!deepEq(a[k], b[k])) return false;
  return true;
}

// 'YYYY-MM-DD' stays as is; an ISO timestamp becomes its IST calendar day.
export function dayKey(v: any): string {
  if (!v) return "";
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const t = new Date(v).getTime();
  if (isNaN(t)) return "";
  return new Date(t + IST_MS).toISOString().slice(0, 10);
}

const arr = (v: any): any[] => (Array.isArray(v) ? v : []);
const num = (v: any): number => (typeof v === "number" && isFinite(v) ? v : 0);
// Object.create(null): a bill whose id is "__proto__" must be an ordinary key, not a way to hide bills.
const idMap = (list: any[]) => {
  const m: Record<string, any> = Object.create(null);
  for (const x of list) if (x && typeof x === "object" && x.id != null) m[String(x.id)] = x;
  return m;
};
const idless = (list: any[]) => list.filter((x) => !x || typeof x !== "object" || x.id == null).length;
const dupes = (list: any[]) => { const seen = Object.create(null); let d = 0; for (const x of list) { if (x && x.id != null) { const k = String(x.id); if (seen[k]) d++; seen[k] = 1; } } return d; };
const closedDays = (blob: any): Record<string, boolean> => {
  const m: Record<string, boolean> = Object.create(null);
  for (const c of arr(blob && blob.dayBook && blob.dayBook.closes)) if (c && c.date) m[String(c.date)] = true;
  return m;
};
export function discCaps(blob: any): { staff: number; manager: number } {
  const c = (blob && blob.rates && blob.rates.discCaps) || {};
  return {
    staff: typeof c.staff === "number" ? c.staff : DEFAULT_DISC_CAPS.staff,
    manager: typeof c.manager === "number" ? c.manager : DEFAULT_DISC_CAPS.manager,
  };
}

// Pre-discount bill value. Uses the locked grand the client stored at creation
// (grand = (base - discount) * (1 + gst/100)); falls back to the item lines.
export function saleBase(s: any): number {
  const d = num(s.discount);
  const g = num(s.lockedGrand);
  if (g > 0) return g / (1 + num(s.gst) / 100) + d;
  let sub = num(s.making) + num(s.diamond);
  for (const i of arr(s.items)) sub += num(i.lockedRate || i.rate) * num(i.weight) * (num(i.qty) || 1) + num(i.making) + num(i.diamond);
  return sub;
}
const pctOf = (s: any): number => { const b = saleBase(s); return b > 0 ? (num(s.discount) / b) * 100 : 0; };

// Money fields the app reads as numbers. A text value like "90000" counts as 0 here but the app would subtract it.
const MONEY_KEYS = ["discount", "lockedGrand", "advance", "gst", "making", "diamond"];
function badMoneyType(s: any): boolean {
  for (const k of MONEY_KEYS) if (s[k] != null && (typeof s[k] !== "number" || !isFinite(s[k]))) return true;
  for (const i of arr(s.items)) {
    if (!i || typeof i !== "object") return true;
    for (const k of ["weight", "qty", "lockedRate", "making", "diamond"]) if (i[k] != null && (typeof i[k] !== "number" || !isFinite(i[k]))) return true;
  }
  return false;
}
// The bill total can never be much below the metal value of its own lines (making and stones only add to it):
// grand >= gold value * (1 - cap) * (1 + gst) less slack. Stops a "total 1" bill that hides a 100% discount.
export const TOTAL_FLOOR_SLACK = 0.03;
function totalTooLow(s: any, capPct: number): boolean {
  let gv = 0;
  for (const i of arr(s.items)) gv += num(i.lockedRate) * num(i.weight) * (num(i.qty) || 1);
  if (!(gv > 0) || !(num(s.lockedGrand) > 0)) return false;
  return num(s.lockedGrand) < gv * (1 - capPct / 100 - TOTAL_FLOOR_SLACK) * (1 + num(s.gst) / 100);
}

function negativeAmount(s: any): boolean {
  if (num(s.lockedGrand) < 0 || num(s.discount) < 0 || num(s.advance) < 0) return true;
  for (const i of arr(s.items)) {
    if (num(i.weight) < 0 || num(i.qty) < 0 || num(i.making) < 0 || num(i.lockedRate) < 0 || num(i.diamond) < 0) return true;
  }
  return false;
}

// What the client's own startup migration may fill in on an old bill
// (migrateLockRates): a missing lockedGrand and missing item lockedRate.
// Treat those as "not a change" so a staff device that migrates on load is not refused.
function withoutMigration(before: any, after: any, role: string): any {
  const a = JSON.parse(JSON.stringify(after));
  // migrateLockRates sets lockedGrand = advance on a fully-paid bill; a manager's Mark as Paid may set the bill's own total.
  if (!(num(before.lockedGrand) > 0) && num(a.lockedGrand) > 0) {
    const asMigration = before.payStatus === "full" && Math.abs(num(a.lockedGrand) - num(before.advance)) < 0.01;
    if (asMigration || role === "manager") a.lockedGrand = before.lockedGrand;
  }
  const bi = arr(before.items), ai = arr(a.items);
  if (bi.length === ai.length) for (let i = 0; i < ai.length; i++) if (!bi[i].lockedRate && ai[i].lockedRate) ai[i].lockedRate = bi[i].lockedRate;
  return a;
}

const isPrefix = (shorter: any[], longer: any[]) => shorter.length <= longer.length && shorter.every((x, i) => deepEq(x, longer[i]));
const changedKeys = (a: any, b: any): string[] => {
  const keys: Record<string, boolean> = Object.create(null);
  for (const k of Object.keys(a)) keys[k] = true;
  for (const k of Object.keys(b)) keys[k] = true;
  return Object.keys(keys).filter((k) => !deepEq(a[k], b[k]));
};

function checkNewSale(role: string, s: any, caps: any, closed: Record<string, boolean>): Violation | null {
  const inv = s.invNo || s.id;
  if (badMoneyType(s)) return bad("bad_amount", "Bill " + inv + " has an amount that is not a number, so it cannot be saved.");
  if (negativeAmount(s)) return bad("negative_amount", "Bill " + inv + " has a negative amount, so it cannot be saved.");
  if (BLOCK_NEW_SALE_ON_CLOSED_DAY && closed[dayKey(s.date)]) return bad("closed_day", "That day is closed. A new bill cannot be added to it. Ask the owner.");
  const cap = role === "manager" ? caps.manager : caps.staff;
  const pct = pctOf(s);
  if (pct > cap + DISC_PCT_SLACK) return bad("discount_over_cap", "Bill " + inv + ": discount is " + pct.toFixed(2) + "% and your limit is " + cap + "%. Ask the owner.");
  if (totalTooLow(s, cap)) return bad("total_below_items", "Bill " + inv + ": the total is far below the value of its items, so it cannot be saved. Ask the owner.");
  return null;
}

function checkChangedSale(role: string, before: any, afterRaw: any, caps: any, closed: Record<string, boolean>): Violation | null {
  if (deepEq(before, afterRaw)) return null;   // most bills in a save are untouched: skip the copy below
  const after = withoutMigration(before, afterRaw, role);
  const keys = changedKeys(before, after);
  if (!keys.length) return null;
  const inv = before.invNo || before.id;
  const onClosedDay = !!closed[dayKey(before.date)];

  // payment keys: append-only, never a lowered or negative amount
  if (keys.indexOf("extraPayments") !== -1) {
    const b = arr(before.extraPayments), a = arr(after.extraPayments);
    if (!isPrefix(b, a)) return bad("payment_rewritten", "Bill " + inv + ": earlier payments cannot be changed or removed.");
    for (const p of a.slice(b.length)) {
      if (!(num(p && p.amount) > 0)) return bad("negative_amount", "Bill " + inv + ": a payment must be more than zero.");
      // Tanish, 14 Nov 2026: staff cannot reverse a payment (manager and owner can).
      if (role !== "manager" && p.type === "reversal") return bad("staff_reversal", "Staff cannot reverse a payment. Ask the owner or a manager.");
    }
  }
  if (keys.indexOf("paymentHistory") !== -1) {
    const hb2 = arr(before.paymentHistory), ha2 = arr(after.paymentHistory);
    if (!isPrefix(hb2, ha2)) return bad("payment_rewritten", "Bill " + inv + ": payment history cannot be changed or removed.");
    for (const p of ha2.slice(hb2.length)) if (!(num(p && p.amount) > 0)) return bad("negative_amount", "Bill " + inv + ": a payment must be more than zero.");
  }
  // staff marking a bill paid without recording any payment is not a thing the app does (a manager's Edit Bill recomputes the status)
  if (role !== "manager" && (keys.indexOf("payStatus") !== -1 || keys.indexOf("paidAt") !== -1) && !(arr(after.extraPayments).length > arr(before.extraPayments).length)) {
    return bad("payment_rewritten", "Bill " + inv + ": its paid status cannot change without a payment.");
  }
  const other = keys.filter((k) => PAYMENT_KEYS.indexOf(k) === -1);
  if (!other.length) return null;   // a payment only: allowed for every role

  if (role !== "manager") return bad("staff_edit", "Staff cannot change a bill that is already saved. Ask the owner or a manager.");

  // manager: a refund, an edit (history grows with a reason), or Mark as Paid (lockedGrand/items migration already ignored)
  const refundOnly = other.every((k) => REFUND_KEYS.indexOf(k) !== -1);
  if (refundOnly) {
    const rb = arr(before.refunds), ra = arr(after.refunds);
    if (!isPrefix(rb, ra)) return bad("refund_rewritten", "Bill " + inv + ": earlier refunds cannot be changed or removed.");
    for (const r of ra.slice(rb.length)) {
      if (!String(r && r.reason || "").trim()) return bad("reason_required", "A refund needs a reason.");
      if (!(num(r.amount) > 0)) return bad("negative_amount", "A refund must be more than zero.");
    }
    if (onClosedDay) return bad("closed_day", "Bill " + inv + " is on a closed day. Only the owner can refund it.");
    return null;
  }
  const hb = arr(before.editHistory), ha = arr(after.editHistory);
  if (ha.length > hb.length && isPrefix(hb, ha)) {
    if (badMoneyType(after)) return bad("bad_amount", "Bill " + inv + " has an amount that is not a number, so it cannot be saved.");
    if (!isPrefix(arr(before.refunds), arr(after.refunds))) return bad("refund_rewritten", "Bill " + inv + ": earlier refunds cannot be changed or removed.");
    if (closed[dayKey(after.date)]) return bad("closed_day", "An edit cannot move a bill onto a closed day. Only the owner can.");
    for (const h of ha.slice(hb.length)) if (!String(h && h.reason || "").trim()) return bad("reason_required", "An edit needs a reason.");
    if (onClosedDay) return bad("closed_day", "Bill " + inv + " is on a closed day. Only the owner can edit it.");
    if (negativeAmount(after)) return bad("negative_amount", "Bill " + inv + " has a negative amount, so it cannot be saved.");
    // same rule as the client: refuse only when over the cap AND above the bill's own earlier percent
    const pct = pctOf(after);
    if (pct > caps.manager + DISC_PCT_SLACK && pct > pctOf(before) + 0.05) {
      return bad("discount_over_cap", "Bill " + inv + ": discount is " + pct.toFixed(2) + "% and your limit is " + caps.manager + "%. Ask the owner.");
    }
    if (totalTooLow(after, caps.manager) && !totalTooLow(before, caps.manager)) return bad("total_below_items", "Bill " + inv + ": the total is far below the value of its items, so it cannot be saved. Ask the owner.");
    return null;
  }
  return bad("edit_needs_reason", "Bill " + inv + " was changed without going through Edit Bill with a reason.");
}

// A manager removes a bill only as a void: number kept in voidedInvNos, a new
// audit entry with the reason, and the bill's day still open.
function checkVoid(sale: any, cur: any, next: any, closed: Record<string, boolean>): Violation | null {
  const inv = sale.invNo || sale.id;
  if (closed[dayKey(sale.date)]) return bad("closed_day", "Bill " + inv + " is on a closed day. Only the owner can void it.");
  if (sale.invNo && arr(next.voidedInvNos).indexOf(sale.invNo) === -1) return bad("void_not_recorded", "Bill " + inv + " was removed without recording the void.");
  const had: Record<string, boolean> = {};
  for (const e of arr(cur.auditLog)) if (e && e.id) had[e.id] = true;
  const ok = arr(next.auditLog).some((e: any) => e && !had[e.id] && e.entity === "sale" && String(e.entityId) === String(sale.id) &&
    /\| reason: \S/.test(String(e.note || "")));
  if (!ok) return bad("reason_required", "Voiding bill " + inv + " needs a reason.");
  return null;
}

function checkRoleWriteInner(role: string, cur: any, next: any): Violation | null {
  if (role === "owner") return null;
  if (!cur || typeof cur !== "object" || !next || typeof next !== "object") return null;   // first save of a shop
  const isManager = role === "manager";   // anything else (staff, unknown) gets the strict staff rules

  for (const k of PROTECTED_KEYS) {
    if (!deepEq(cur[k], next[k])) return bad("protected_key", "This setting is changed by the owner only.");
  }

  // shrink guard
  if (!isManager && arr(next.sales).length < arr(cur.sales).length) return bad("staff_delete", "Staff cannot remove bills. Ask the owner or a manager.");
  for (const k of SHRINK_LISTS) {
    const c = arr(cur[k]).length, n = arr(next[k]).length;
    if (c >= SHRINK_MIN_LEN && n < c * (1 - SHRINK_MAX_FRACTION)) return bad("mass_delete", "Too many " + k + " were removed in one save. Ask the owner.");
  }

  // rates
  const cr = cur.rates || {}, nr = next.rates || {};
  if (!deepEq(cr.discCaps, nr.discCaps)) return bad("owner_only", "Only the owner can change the discount limits.");
  if (!isManager) {
    // every rate that existed must be unchanged; a key the client newly adds on load is tolerated
    for (const k of Object.keys(cr)) if (!deepEq(cr[k], nr[k])) return bad("staff_rates", "Staff cannot change rates. Ask the owner or a manager.");
  }

  // Day Book close / reopen
  const cd = cur.dayBook || {}, nd = next.dayBook || {};
  if (!deepEq(cd.reopens, nd.reopens)) return bad("owner_only", "Only the owner can reopen a closed day.");
  if (!isManager) {
    if (!deepEq(cd.closes, nd.closes)) return bad("staff_close", "Staff cannot close or change a closed day. Ask the owner or a manager.");
  } else {
    const have: Record<string, boolean> = {};
    for (const c of arr(nd.closes)) if (c && c.date) have[String(c.date)] = true;
    for (const c of arr(cd.closes)) if (c && c.date && !have[String(c.date)]) return bad("owner_only", "Only the owner can reopen a closed day.");
  }

  // invoice numbers never go back
  for (const v of arr(cur.voidedInvNos)) if (arr(next.voidedInvNos).indexOf(v) === -1) return bad("owner_only", "A cancelled invoice number cannot be released.");
  if (num(next.nextInvNo) < num(cur.nextInvNo)) return bad("owner_only", "The invoice number counter cannot be lowered.");

  // sales
  const caps = discCaps(cur), closed = closedDays(cur);
  if (!Array.isArray(next.sales) && next.sales != null) return bad("malformed", "The bills list is damaged, so this save was refused.");
  if (idless(arr(next.sales)) > idless(arr(cur.sales)) || dupes(arr(next.sales)) > dupes(arr(cur.sales))) return bad("bad_ids", "A bill without its own id, or two bills with the same id, cannot be saved.");
  const cs = idMap(arr(cur.sales)), ns = idMap(arr(next.sales));
  const usedNos = Object.create(null);
  for (const x of arr(cur.sales)) if (x && x.invNo) usedNos[String(x.invNo)] = 1;
  for (const v of arr(cur.voidedInvNos)) usedNos[String(v)] = 1;
  for (const id of Object.keys(cs)) {
    if (!ns[id]) {
      if (!isManager) return bad("staff_delete", "Staff cannot remove bills. Ask the owner or a manager.");
      const v = checkVoid(cs[id], cur, next, closed);
      if (v) return v;
    } else {
      const v = checkChangedSale(role, cs[id], ns[id], caps, closed);
      if (v) return v;
    }
  }
  for (const id of Object.keys(ns)) {
    if (cs[id]) continue;
    if (ns[id].invNo && usedNos[String(ns[id].invNo)]) return bad("invoice_reused", "Invoice number " + ns[id].invNo + " was already used, so this bill cannot be saved.");
    const v = checkNewSale(role, ns[id], caps, closed);
    if (v) return v;
  }
  return null;
}

// Public entry. A bill or list shaped so oddly that the rules throw is refused, never waved through:
// otherwise a deliberate crash would switch the whole check off for that save.
export function checkRoleWrite(role: string, cur: any, next: any): Violation | null {
  try {
    return checkRoleWriteInner(role, cur, next);
  } catch (_e) {
    if (role === "owner") return null;
    return bad("malformed", "This save has data the shop cannot read, so it was refused.");
  }
}
