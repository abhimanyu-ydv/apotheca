/**
 * Currency and GST maths.
 *
 * Everything rounds through paise (integer 1/100 rupee) rather than
 * accumulating floats. The old code summed `line / (1 + gst/100)` in a loop, so
 * a 30-line bill could drift a paisa or two away from the printed total — which
 * is the kind of thing a GST audit actually notices.
 */

import type { GstRate } from "./types";

export const GST_RATES: readonly GstRate[] = [0, 5, 12, 18];

/** Rupees -> integer paise, half-up. */
export const toPaise = (rupees: number): number =>
  Math.round((Number(rupees) || 0) * 100);

/** Integer paise -> rupees. */
export const toRupees = (paise: number): number => paise / 100;

export function formatMoney(rupees: number): string {
  const n = Number(rupees) || 0;
  return `₹${n.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Compact form for dashboard tiles: ₹1.24L, ₹3.1Cr. */
export function formatMoneyShort(rupees: number): string {
  const n = Number(rupees) || 0;
  const abs = Math.abs(n);
  if (abs >= 1e7) return `₹${(n / 1e7).toFixed(2)}Cr`;
  if (abs >= 1e5) return `₹${(n / 1e5).toFixed(2)}L`;
  if (abs >= 1e3) return `₹${(n / 1e3).toFixed(1)}k`;
  return formatMoney(n);
}

export interface LineTax {
  /** Ex-GST value of the line, in paise. */
  readonly taxablePaise: number;
  /** GST component of the line, in paise. */
  readonly gstPaise: number;
  /** Gross (MRP × qty), in paise. */
  readonly grossPaise: number;
}

/**
 * Indian MRP is tax-inclusive, so GST is back-calculated out of the line total
 * rather than added on top.
 */
export function splitLineTax(
  mrp: number,
  qty: number,
  gstRate: GstRate,
): LineTax {
  const grossPaise = toPaise(mrp) * Math.max(0, Math.trunc(qty));
  const taxablePaise = Math.round(grossPaise / (1 + gstRate / 100));
  return {
    grossPaise,
    taxablePaise,
    gstPaise: grossPaise - taxablePaise,
  };
}

export interface BillTotals {
  readonly taxable: number;
  readonly gstTotal: number;
  readonly gross: number;
  readonly discountPct: number;
  readonly discountAmt: number;
  readonly net: number;
  /** GST broken out by rate slab — required on a compliant tax invoice. */
  readonly gstBySlab: ReadonlyArray<{
    readonly rate: GstRate;
    readonly taxable: number;
    readonly gst: number;
  }>;
}

export interface TaxableLine {
  readonly mrp: number;
  readonly qty: number;
  readonly gst: GstRate;
}

export function computeTotals(
  lines: readonly TaxableLine[],
  discountPct: number,
): BillTotals {
  const bySlab = new Map<GstRate, { taxable: number; gst: number }>();
  let taxablePaise = 0;
  let gstPaise = 0;

  for (const line of lines) {
    const t = splitLineTax(line.mrp, line.qty, line.gst);
    taxablePaise += t.taxablePaise;
    gstPaise += t.gstPaise;

    const slab = bySlab.get(line.gst) ?? { taxable: 0, gst: 0 };
    slab.taxable += t.taxablePaise;
    slab.gst += t.gstPaise;
    bySlab.set(line.gst, slab);
  }

  const grossPaise = taxablePaise + gstPaise;
  const pct = Math.min(100, Math.max(0, Number(discountPct) || 0));
  const discountPaise = Math.round(grossPaise * (pct / 100));

  return {
    taxable: toRupees(taxablePaise),
    gstTotal: toRupees(gstPaise),
    gross: toRupees(grossPaise),
    discountPct: pct,
    discountAmt: toRupees(discountPaise),
    net: toRupees(grossPaise - discountPaise),
    gstBySlab: [...bySlab.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([rate, v]) => ({
        rate,
        taxable: toRupees(v.taxable),
        gst: toRupees(v.gst),
      })),
  };
}
