/**
 * Search over the formulary and the shelf.
 *
 * The previous implementation rebuilt a cross-product of every drug × form ×
 * strength on each keystroke and ran `stock.filter` inside that triple loop.
 * Here the product list is precomputed once (`CATALOG_PRODUCTS`) and stock is
 * read from the prebuilt index, so a keystroke is a scan of a flat array with
 * hash lookups instead of a nested rescan.
 */

import { CATALOG_PRODUCTS, type CatalogDrug } from "./catalog";
import { availableQty, batchesFor, type StockIndex } from "./inventory";
import { isDispensable } from "./expiry";
import type { Batch, DosageForm } from "./types";

export const MIN_QUERY_LENGTH = 2;

export interface ProductHit {
  readonly key: string;
  readonly name: string;
  readonly form: DosageForm;
  readonly strength: string;
  readonly drug: CatalogDrug;
  /** Dispensable units across all non-expired batches. */
  readonly qty: number;
  /** Batches for this product, earliest expiry first. */
  readonly batches: readonly Batch[];
  /** Nearest-expiry dispensable batch, if any. */
  readonly nearest: Batch | undefined;
}

export interface SearchOptions {
  /** Only show products with stock on the shelf. */
  readonly inStockOnly?: boolean;
  readonly limit?: number;
  readonly now?: Date;
}

export function searchProducts(
  query: string,
  index: StockIndex,
  options: SearchOptions = {},
): readonly ProductHit[] {
  const q = query.trim().toLowerCase();
  if (q.length < MIN_QUERY_LENGTH) return [];

  const { inStockOnly = false, limit = 30, now } = options;
  const hits: ProductHit[] = [];

  for (const product of CATALOG_PRODUCTS) {
    if (!product.haystack.includes(q)) continue;

    const batches = batchesFor(index, product);
    const qty = availableQty(index, product, now);
    if (inStockOnly && qty <= 0) continue;

    hits.push({
      key: `${product.name}|${product.form}|${product.strength}`,
      name: product.name,
      form: product.form,
      strength: product.strength,
      drug: product.drug,
      qty,
      batches,
      nearest: batches.find((b) => isDispensable(b, now)),
    });
  }

  // In-stock first, then alphabetical. Counter staff want what they can sell.
  hits.sort((a, b) => {
    if (a.qty > 0 !== b.qty > 0) return a.qty > 0 ? -1 : 1;
    return a.name.localeCompare(b.name) || a.strength.localeCompare(b.strength);
  });

  return hits.slice(0, limit);
}

/**
 * Batches present on the shelf that the formulary doesn't know about — a drug
 * entered by hand. Without this they'd be invisible to type-ahead.
 */
export function searchLooseBatches(
  query: string,
  index: StockIndex,
  limit = 10,
): readonly Batch[] {
  const q = query.trim().toLowerCase();
  if (q.length < MIN_QUERY_LENGTH) return [];

  const known = new Set(CATALOG_PRODUCTS.map((p) => p.name.toLowerCase()));
  const out: Batch[] = [];

  for (const batch of index.all) {
    if (known.has(batch.name.toLowerCase())) continue;
    if (!(index.haystack.get(batch.id) ?? "").includes(q)) continue;
    out.push(batch);
    if (out.length >= limit) break;
  }
  return out;
}

/** Free-text filter over the shelf, using the index's precomputed haystack. */
export function filterBatches(
  index: StockIndex,
  query: string,
  form: DosageForm | "All" = "All",
): readonly Batch[] {
  const q = query.trim().toLowerCase();
  return index.all.filter((batch) => {
    if (form !== "All" && batch.form !== form) return false;
    if (!q) return true;
    return (index.haystack.get(batch.id) ?? "").includes(q);
  });
}
