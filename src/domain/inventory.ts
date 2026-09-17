/**
 * Inventory selectors and the FEFO allocator.
 *
 * Efficiency note: the old screens did `stock.find(...)` inside `stock.map(...)`
 * (O(n·m) per bill) and re-scanned the whole shelf on every keystroke. Building
 * one `StockIndex` per stock change and reading from it turns those into hash
 * lookups.
 */

import type { AdjustReason, Batch, DosageForm, ProductKey } from "./types";
import { expiryStatus, isDispensable, isExpired } from "./expiry";

/* -------------------------------------------------------------- index */

/** Stable key for "the same sellable product", used to group batches. */
export function productKey(p: ProductKey): string {
  return `${p.name.toLowerCase()}|${p.form}|${p.strength.toLowerCase()}`;
}

export interface StockIndex {
  readonly all: readonly Batch[];
  /** batchId -> batch */
  readonly byId: ReadonlyMap<string, Batch>;
  /** productKey -> its batches, sorted earliest-expiry-first */
  readonly byProduct: ReadonlyMap<string, readonly Batch[]>;
  /** Lowercased searchable text per batch id. */
  readonly haystack: ReadonlyMap<string, string>;
}

export function buildStockIndex(stock: readonly Batch[]): StockIndex {
  const byId = new Map<string, Batch>();
  const grouped = new Map<string, Batch[]>();
  const haystack = new Map<string, string>();

  for (const batch of stock) {
    byId.set(batch.id, batch);
    haystack.set(
      batch.id,
      `${batch.name} ${batch.brand} ${batch.batchNo} ${batch.strength} ${batch.mfr} ${batch.rack}`.toLowerCase(),
    );
    const key = productKey(batch);
    const bucket = grouped.get(key);
    if (bucket) bucket.push(batch);
    else grouped.set(key, [batch]);
  }

  for (const bucket of grouped.values()) {
    bucket.sort(byExpiryAsc);
  }

  return { all: stock, byId, byProduct: grouped, haystack };
}

export const byExpiryAsc = (a: Batch, b: Batch): number =>
  a.expiry < b.expiry ? -1 : a.expiry > b.expiry ? 1 : 0;

export function batchesFor(index: StockIndex, p: ProductKey): readonly Batch[] {
  return index.byProduct.get(productKey(p)) ?? [];
}

/** Sellable quantity for a product — expired batches excluded. */
export function availableQty(
  index: StockIndex,
  p: ProductKey,
  now?: Date,
): number {
  let total = 0;
  for (const b of batchesFor(index, p)) {
    if (isDispensable(b, now)) total += b.qty;
  }
  return total;
}

/* ------------------------------------------------------- FEFO allocation */

export interface Allocation {
  readonly batch: Batch;
  readonly qty: number;
}

export interface AllocationResult {
  readonly lines: readonly Allocation[];
  /** Requested but unavailable. Zero means fully satisfied. */
  readonly shortfall: number;
}

/**
 * First-Expiry-First-Out: take the requested quantity from the batches closest
 * to expiry, spilling into the next batch when one runs short.
 *
 * This is the rule pharmacies are actually meant to follow, and doing it by
 * hand across batches is where counter staff make mistakes. Previously the UI
 * only let you dispense one batch at a time and left the choice to the operator.
 */
export function allocateFefo(
  index: StockIndex,
  product: ProductKey,
  requestedQty: number,
  now?: Date,
): AllocationResult {
  let remaining = Math.max(0, Math.trunc(requestedQty));
  const lines: Allocation[] = [];

  for (const batch of batchesFor(index, product)) {
    if (remaining <= 0) break;
    if (!isDispensable(batch, now)) continue;
    const take = Math.min(batch.qty, remaining);
    lines.push({ batch, qty: take });
    remaining -= take;
  }

  return { lines, shortfall: remaining };
}

/* -------------------------------------------------------- shelf reports */

export const stockValue = (stock: readonly Batch[]): number =>
  stock.reduce((sum, b) => sum + b.qty * (b.cost || b.mrp), 0);

export const retailValue = (stock: readonly Batch[]): number =>
  stock.reduce((sum, b) => sum + b.qty * b.mrp, 0);

export const isLowStock = (b: Batch): boolean =>
  b.reorder > 0 && b.qty <= b.reorder;

export interface ExpiryBuckets {
  readonly expired: readonly Batch[];
  readonly critical: readonly Batch[];
  readonly warning: readonly Batch[];
  readonly ok: readonly Batch[];
}

export function bucketByExpiry(
  stock: readonly Batch[],
  now?: Date,
): ExpiryBuckets {
  const expired: Batch[] = [];
  const critical: Batch[] = [];
  const warning: Batch[] = [];
  const ok: Batch[] = [];

  for (const b of stock) {
    switch (expiryStatus(b.expiry, now).level) {
      case "expired":
        expired.push(b);
        break;
      case "critical":
        critical.push(b);
        break;
      case "warning":
        warning.push(b);
        break;
      default:
        ok.push(b);
    }
  }
  [expired, critical, warning, ok].forEach((a) => a.sort(byExpiryAsc));
  return { expired, critical, warning, ok };
}

/** Value at risk if the expired batches are written off. */
export const writeOffValue = (batches: readonly Batch[]): number =>
  batches.reduce((sum, b) => sum + b.qty * (b.cost || b.mrp), 0);

/**
 * Reorder report, grouped by product rather than batch — the buyer cares about
 * "how much Paracetamol 500 do we need", not about individual batch numbers.
 */
export interface ReorderRow {
  readonly key: string;
  readonly name: string;
  readonly form: DosageForm;
  readonly strength: string;
  readonly onHand: number;
  readonly reorderLevel: number;
  readonly deficit: number;
  readonly rack: string;
}

export function reorderReport(
  index: StockIndex,
  now?: Date,
): readonly ReorderRow[] {
  const rows: ReorderRow[] = [];

  for (const [key, batches] of index.byProduct) {
    const live = batches.filter((b) => !isExpired(b, now));
    if (live.length === 0) continue;

    const onHand = live.reduce((n, b) => n + b.qty, 0);
    const reorderLevel = Math.max(...live.map((b) => b.reorder), 0);
    if (reorderLevel <= 0 || onHand > reorderLevel) continue;

    const head = live[0]!;
    rows.push({
      key,
      name: head.name,
      form: head.form,
      strength: head.strength,
      onHand,
      reorderLevel,
      deficit: reorderLevel - onHand,
      rack: head.rack,
    });
  }

  return rows.sort((a, b) => b.deficit - a.deficit);
}

/* ------------------------------------------------------------ mutations */

/**
 * Apply many quantity deltas in a single pass.
 *
 * Replaces the old `stock.map(i => bill.lines.find(l => l.id === i.id))`, which
 * re-scanned the bill for every batch on the shelf.
 */
export function applyQuantityDeltas(
  stock: readonly Batch[],
  deltas: ReadonlyMap<string, number>,
): readonly Batch[] {
  if (deltas.size === 0) return stock;
  return stock.map((batch) => {
    const delta = deltas.get(batch.id);
    if (delta === undefined || delta === 0) return batch;
    return { ...batch, qty: Math.max(0, batch.qty + delta) };
  });
}

export interface AdjustmentRequest {
  readonly batchId: string;
  readonly delta: number;
  readonly reason: AdjustReason;
  readonly note?: string;
}

/** Duplicate batch numbers within the same drug are a receiving error. */
export function findDuplicateBatch(
  stock: readonly Batch[],
  name: string,
  batchNo: string,
): Batch | undefined {
  const n = name.trim().toLowerCase();
  const b = batchNo.trim().toLowerCase();
  return stock.find(
    (item) =>
      item.name.trim().toLowerCase() === n &&
      item.batchNo.trim().toLowerCase() === b,
  );
}
