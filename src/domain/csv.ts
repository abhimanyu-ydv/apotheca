/**
 * CSV generation. Pure string work — the platform layer decides how to hand
 * the result to the user (download on web, share sheet on mobile, fs on desktop).
 */

import type { AuditEntry, Batch, Bill } from "./types";
import { daysUntil, formatDate, formatDateTime } from "./expiry";

function escape(value: unknown): string {
  const s = value == null ? "" : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(
  headers: readonly string[],
  rows: readonly (readonly unknown[])[],
): string {
  const lines = [headers.map(escape).join(",")];
  for (const row of rows) lines.push(row.map(escape).join(","));
  // BOM so Excel on Windows reads ₹ and non-ASCII names correctly.
  return `﻿${lines.join("\r\n")}\r\n`;
}

export function inventoryCsv(stock: readonly Batch[], now?: Date): string {
  return toCsv(
    [
      "Medicine", "Brand", "Form", "Strength", "Batch No", "Expiry",
      "Days left", "Qty", "MRP", "Cost", "GST %", "Stock value",
      "Manufacturer", "Rack", "Reorder level", "Schedule", "Received", "Received by",
    ],
    stock.map((b) => [
      b.name, b.brand, b.form, b.strength, b.batchNo, b.expiry,
      daysUntil(b.expiry, now), b.qty, b.mrp, b.cost, b.gst,
      (b.qty * (b.cost || b.mrp)).toFixed(2),
      b.mfr, b.rack, b.reorder, b.sch, formatDate(b.addedAt), b.addedBy,
    ]),
  );
}

/** One row per bill line — the shape an accountant actually wants. */
export function billsCsv(bills: readonly Bill[]): string {
  const rows: unknown[][] = [];
  for (const bill of bills) {
    for (const line of bill.lines) {
      rows.push([
        bill.no, formatDateTime(bill.at), bill.status,
        bill.patientName, bill.patientId, bill.doctor,
        line.name, line.strength, line.form, line.batchNo, formatDate(line.expiry),
        line.qty, line.mrp, (line.qty * line.mrp).toFixed(2), line.gst,
        bill.discountPct, bill.net, bill.pay, bill.payRef, bill.byName,
      ]);
    }
  }
  return toCsv(
    [
      "Bill No", "Date", "Status", "Patient", "Patient ID", "Doctor",
      "Medicine", "Strength", "Form", "Batch", "Expiry",
      "Qty", "MRP", "Line total", "GST %",
      "Bill discount %", "Bill net", "Payment", "Reference", "Dispensed by",
    ],
    rows,
  );
}

export function auditCsv(log: readonly AuditEntry[]): string {
  return toCsv(
    ["When", "User", "Action", "Details"],
    log.map((e) => [formatDateTime(e.at), e.actorName, e.action, e.summary]),
  );
}
