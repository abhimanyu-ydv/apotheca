/**
 * GST arithmetic — the server's copy.
 *
 * Deliberately duplicated from `src/domain/money.ts` rather than imported:
 * the API must not trust a total the browser computed. The client shows a
 * figure; the server decides it. If the two ever disagree, the server wins and
 * that is a bug worth finding.
 *
 * Everything runs through integer paise so a 30-line bill can't drift.
 */

export type GstRate = 0 | 5 | 12 | 18;

export const toPaise = (rupees: number | string): number =>
  Math.round(Number(rupees) * 100);

export const toRupees = (paise: number): number => paise / 100;

export interface TaxableLine {
  mrp: number | string;
  qty: number;
  gst: GstRate | number;
}

export interface Totals {
  taxable: number;
  gstTotal: number;
  gross: number;
  discountPct: number;
  discountAmt: number;
  net: number;
  bySlab: Array<{ rate: number; taxable: number; gst: number }>;
}

/** Indian MRP is tax-inclusive, so GST is extracted, not added. */
export function computeTotals(
  lines: readonly TaxableLine[],
  discountPct: number,
): Totals {
  const slabs = new Map<number, { taxable: number; gst: number }>();
  let taxablePaise = 0;
  let gstPaise = 0;

  for (const line of lines) {
    const grossPaise = toPaise(line.mrp) * Math.max(0, Math.trunc(line.qty));
    const linePaise = Math.round(grossPaise / (1 + Number(line.gst) / 100));
    const lineGst = grossPaise - linePaise;

    taxablePaise += linePaise;
    gstPaise += lineGst;

    const slab = slabs.get(Number(line.gst)) ?? { taxable: 0, gst: 0 };
    slab.taxable += linePaise;
    slab.gst += lineGst;
    slabs.set(Number(line.gst), slab);
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
    bySlab: [...slabs.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([rate, v]) => ({
        rate,
        taxable: toRupees(v.taxable),
        gst: toRupees(v.gst),
      })),
  };
}
