/**
 * Cart rules and bill construction — pure, so the same logic drives the web
 * counter, a mobile counter, and eventually a server-side POST /bills.
 */

import type {
  Batch,
  Bill,
  BillLine,
  Instant,
  PaymentMode,
  User,
} from "./types";
import { computeTotals, type BillTotals } from "./money";
import { expiryStatus } from "./expiry";
import { generateBillNumber, randomId } from "./ids";
import { allocateFefo, productKey, type StockIndex } from "./inventory";

export const PAYMENT_MODES: readonly PaymentMode[] = [
  "Cash",
  "UPI",
  "GPay",
  "Paytm",
  "Debit Card",
  "Credit Card",
  "Net Banking",
  "Insurance",
  "Other",
];

/** Modes that carry a transaction reference worth recording. */
export const MODES_NEEDING_REF: ReadonlySet<PaymentMode> = new Set<PaymentMode>(
  ["UPI", "GPay", "Paytm", "Debit Card", "Credit Card", "Net Banking", "Other"],
);

export interface CartItem {
  readonly batchId: string;
  readonly qty: number;
}

/** A cart line joined against live stock, ready to render. */
export interface ResolvedCartLine {
  readonly batch: Batch;
  readonly qty: number;
  readonly lineTotal: number;
  /** Set when the line can no longer be dispensed as-is. */
  readonly problem: string | null;
}

export type CartError =
  | { readonly kind: "expired"; readonly message: string }
  | { readonly kind: "insufficient"; readonly message: string }
  | { readonly kind: "missing"; readonly message: string };

/* -------------------------------------------------------------- cart ops */

export function addToCart(
  cart: readonly CartItem[],
  batch: Batch,
  qty = 1,
  now?: Date,
): { cart: readonly CartItem[]; error: CartError | null } {
  if (expiryStatus(batch.expiry, now).level === "expired") {
    return {
      cart,
      error: {
        kind: "expired",
        message: `Batch ${batch.batchNo} has expired and cannot be dispensed.`,
      },
    };
  }

  const existing = cart.find((c) => c.batchId === batch.id);
  const wanted = (existing?.qty ?? 0) + qty;

  if (wanted > batch.qty) {
    return {
      cart,
      error: {
        kind: "insufficient",
        message: `Only ${batch.qty} left in batch ${batch.batchNo}.`,
      },
    };
  }

  const next = existing
    ? cart.map((c) => (c.batchId === batch.id ? { ...c, qty: wanted } : c))
    : [...cart, { batchId: batch.id, qty }];

  return { cart: next, error: null };
}

export function setCartQty(
  cart: readonly CartItem[],
  batchId: string,
  qty: number,
  index: StockIndex,
): { cart: readonly CartItem[]; error: CartError | null } {
  const batch = index.byId.get(batchId);
  if (!batch) {
    return {
      cart: cart.filter((c) => c.batchId !== batchId),
      error: { kind: "missing", message: "That batch is no longer on the shelf." },
    };
  }
  const clamped = Math.max(1, Math.min(Math.trunc(qty) || 1, batch.qty));
  const error: CartError | null =
    qty > batch.qty
      ? { kind: "insufficient", message: `Only ${batch.qty} left in batch ${batch.batchNo}.` }
      : null;

  return {
    cart: cart.map((c) => (c.batchId === batchId ? { ...c, qty: clamped } : c)),
    error,
  };
}

export const removeFromCart = (
  cart: readonly CartItem[],
  batchId: string,
): readonly CartItem[] => cart.filter((c) => c.batchId !== batchId);

/**
 * Add a whole product by quantity, letting FEFO pick the batches.
 * Returns the shortfall so the counter can tell the patient what's missing.
 */
export function addProductFefo(
  cart: readonly CartItem[],
  index: StockIndex,
  product: { name: string; form: Batch["form"]; strength: string },
  qty: number,
  now?: Date,
): { cart: readonly CartItem[]; shortfall: number; batchesUsed: number } {
  // Honour what is already reserved in the cart so FEFO never double-counts.
  const reserved = new Map<string, number>();
  for (const item of cart) reserved.set(item.batchId, item.qty);

  const virtualIndex: StockIndex = {
    ...index,
    byProduct: new Map(
      [...index.byProduct].map(([key, batches]) => [
        key,
        batches.map((b) => {
          const held = reserved.get(b.id) ?? 0;
          return held ? { ...b, qty: Math.max(0, b.qty - held) } : b;
        }),
      ]),
    ),
  };

  const { lines, shortfall } = allocateFefo(virtualIndex, product, qty, now);

  let next = cart;
  for (const line of lines) {
    const existing = next.find((c) => c.batchId === line.batch.id);
    next = existing
      ? next.map((c) =>
          c.batchId === line.batch.id ? { ...c, qty: c.qty + line.qty } : c,
        )
      : [...next, { batchId: line.batch.id, qty: line.qty }];
  }

  return { cart: next, shortfall, batchesUsed: lines.length };
}

/* ------------------------------------------------------------- resolving */

export function resolveCart(
  cart: readonly CartItem[],
  index: StockIndex,
  now?: Date,
): readonly ResolvedCartLine[] {
  const out: ResolvedCartLine[] = [];
  for (const item of cart) {
    const batch = index.byId.get(item.batchId);
    if (!batch) continue;
    const status = expiryStatus(batch.expiry, now);
    const problem =
      status.level === "expired"
        ? "Expired since this was added"
        : item.qty > batch.qty
          ? `Only ${batch.qty} in stock`
          : null;
    out.push({
      batch,
      qty: item.qty,
      lineTotal: batch.mrp * item.qty,
      problem,
    });
  }
  return out;
}

export function cartTotals(
  lines: readonly ResolvedCartLine[],
  discountPct: number,
): BillTotals {
  return computeTotals(
    lines.map((l) => ({ mrp: l.batch.mrp, qty: l.qty, gst: l.batch.gst })),
    discountPct,
  );
}

/* --------------------------------------------------------- bill creation */

export interface BillDraft {
  readonly patientName: string;
  readonly patientId: string;
  readonly doctor: string;
  readonly pay: PaymentMode;
  readonly payRef: string;
  readonly discountPct: number;
}

export type BillValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string };

export function validateBill(
  lines: readonly ResolvedCartLine[],
  draft: BillDraft,
): BillValidation {
  if (lines.length === 0)
    return { ok: false, message: "Add at least one medicine to the bill." };
  if (!draft.patientName.trim())
    return { ok: false, message: "Enter the patient's name." };

  const blocked = lines.find((l) => l.problem);
  if (blocked)
    return {
      ok: false,
      message: `${blocked.batch.name} — ${blocked.problem}. Fix the line before billing.`,
    };

  return { ok: true };
}

export function buildBill(
  lines: readonly ResolvedCartLine[],
  draft: BillDraft,
  user: User,
  existingBills: readonly Bill[],
  now: Date = new Date(),
): Bill {
  const totals = cartTotals(lines, draft.discountPct);
  const at: Instant = now.toISOString();

  const billLines: BillLine[] = lines.map((l) => ({
    batchId: l.batch.id,
    name: l.batch.name,
    brand: l.batch.brand,
    form: l.batch.form,
    strength: l.batch.strength,
    batchNo: l.batch.batchNo,
    expiry: l.batch.expiry,
    mrp: l.batch.mrp,
    gst: l.batch.gst,
    qty: l.qty,
  }));

  return {
    id: randomId(),
    no: generateBillNumber(existingBills, user.pharmacy, now),
    at,
    patientName: draft.patientName.trim(),
    patientId: draft.patientId.trim(),
    doctor: draft.doctor.trim(),
    pay: draft.pay,
    payRef: draft.payRef.trim(),
    byUserId: user.id,
    byName: user.name,
    pharmacy: user.pharmacy,
    lines: billLines,
    taxable: totals.taxable,
    gstTotal: totals.gstTotal,
    discountPct: totals.discountPct,
    discountAmt: totals.discountAmt,
    net: totals.net,
    status: "issued",
  };
}

/** Stock deltas a bill implies: negative on issue, positive on return. */
export function billStockDeltas(
  bill: Bill,
  direction: "issue" | "return",
): ReadonlyMap<string, number> {
  const sign = direction === "issue" ? -1 : 1;
  const deltas = new Map<string, number>();
  for (const line of bill.lines) {
    deltas.set(line.batchId, (deltas.get(line.batchId) ?? 0) + sign * line.qty);
  }
  return deltas;
}

export function markReturned(
  bill: Bill,
  by: User,
  reason: string,
  now: Date = new Date(),
): Bill {
  return {
    ...bill,
    status: "returned",
    returnedAt: now.toISOString(),
    returnedBy: by.name,
    returnReason: reason.trim(),
  };
}

/* -------------------------------------------------------------- reports */

export interface SalesSummary {
  readonly count: number;
  readonly gross: number;
  readonly gst: number;
  readonly discount: number;
  readonly average: number;
}

export function summarise(bills: readonly Bill[]): SalesSummary {
  let gross = 0;
  let gst = 0;
  let discount = 0;
  let count = 0;

  for (const b of bills) {
    if (b.status === "returned") continue;
    count += 1;
    gross += b.net;
    gst += b.gstTotal;
    discount += b.discountAmt;
  }

  return { count, gross, gst, discount, average: count ? gross / count : 0 };
}

/** Units moved per product — feeds "fast movers" on the dashboard. */
export function topMovers(
  bills: readonly Bill[],
  limit = 5,
): ReadonlyArray<{ key: string; name: string; strength: string; units: number }> {
  const tally = new Map<string, { name: string; strength: string; units: number }>();

  for (const bill of bills) {
    if (bill.status === "returned") continue;
    for (const line of bill.lines) {
      const key = productKey(line);
      const entry = tally.get(key);
      if (entry) entry.units += line.qty;
      else
        tally.set(key, {
          name: line.name,
          strength: line.strength,
          units: line.qty,
        });
    }
  }

  return [...tally.entries()]
    .map(([key, v]) => ({ key, ...v }))
    .sort((a, b) => b.units - a.units)
    .slice(0, limit);
}
