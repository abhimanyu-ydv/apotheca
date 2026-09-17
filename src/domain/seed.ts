/**
 * Demo shelf, so a fresh install has something to click through.
 *
 * Deliberately includes two already-expired batches — the expiry block is the
 * feature worth demonstrating first.
 */

import type { Batch, DosageForm, GstRate, Schedule } from "./types";
import { findDrug } from "./catalog";
import { randomId } from "./ids";
import { addDays, toDateInput } from "./expiry";

interface SeedRow {
  readonly name: string;
  readonly brand: string;
  readonly form: DosageForm;
  readonly strength: string;
  readonly qty: number;
  readonly batchNo: string;
  /** Days from today until expiry. Negative = already expired. */
  readonly expiresInDays: number;
  readonly mrp: number;
  readonly cost: number;
  readonly gst: GstRate;
  readonly mfr: string;
  readonly rack: string;
  readonly reorder: number;
}

const ROWS: readonly SeedRow[] = [
  { name: "Paracetamol", brand: "Dolo", form: "Tablet", strength: "650 mg", qty: 420, batchNo: "DL2419", expiresInDays: 400, mrp: 2.1, cost: 1.62, gst: 12, mfr: "Micro Labs", rack: "A-01", reorder: 100 },
  { name: "Paracetamol", brand: "Dolo", form: "Tablet", strength: "650 mg", qty: 60, batchNo: "DL2288", expiresInDays: 48, mrp: 2.1, cost: 1.62, gst: 12, mfr: "Micro Labs", rack: "A-01", reorder: 100 },
  { name: "Paracetamol", brand: "Calpol", form: "Syrup", strength: "125 mg/5 ml", qty: 36, batchNo: "CP1180", expiresInDays: 150, mrp: 48, cost: 36, gst: 12, mfr: "GSK", rack: "A-02", reorder: 12 },
  { name: "Amoxicillin + Clavulanic Acid", brand: "Augmentin", form: "Tablet", strength: "625 mg", qty: 180, batchNo: "AG7741", expiresInDays: 240, mrp: 21.5, cost: 16.8, gst: 12, mfr: "GSK", rack: "B-03", reorder: 60 },
  { name: "Azithromycin", brand: "Azithral", form: "Tablet", strength: "500 mg", qty: 45, batchNo: "AZ5520", expiresInDays: -6, mrp: 28.4, cost: 20.1, gst: 12, mfr: "Alembic", rack: "B-02", reorder: 30 },
  { name: "Pantoprazole", brand: "Pan", form: "Tablet", strength: "40 mg", qty: 260, batchNo: "PN9032", expiresInDays: 310, mrp: 8.4, cost: 5.9, gst: 12, mfr: "Alkem", rack: "B-01", reorder: 80 },
  { name: "Cetirizine", brand: "Cetzine", form: "Tablet", strength: "10 mg", qty: 96, batchNo: "CZ2201", expiresInDays: 22, mrp: 1.9, cost: 1.2, gst: 12, mfr: "Dr. Reddy's", rack: "C-04", reorder: 100 },
  { name: "Metformin", brand: "Glycomet", form: "Tablet", strength: "500 mg", qty: 340, batchNo: "GM5510", expiresInDays: 500, mrp: 3.2, cost: 2.1, gst: 12, mfr: "USV", rack: "C-01", reorder: 120 },
  { name: "Amlodipine", brand: "Amlong", form: "Tablet", strength: "5 mg", qty: 210, batchNo: "AM3390", expiresInDays: 75, mrp: 3.8, cost: 2.4, gst: 12, mfr: "Micro Labs", rack: "C-02", reorder: 100 },
  { name: "Atorvastatin", brand: "Storvas", form: "Tablet", strength: "20 mg", qty: 150, batchNo: "ST7013", expiresInDays: 420, mrp: 9.6, cost: 6.4, gst: 12, mfr: "Sun Pharma", rack: "C-03", reorder: 60 },
  { name: "Ondansetron", brand: "Emeset", form: "Injection", strength: "2 mg/ml", qty: 24, batchNo: "EM4412", expiresInDays: -12, mrp: 16, cost: 11, gst: 12, mfr: "Cipla", rack: "D-01", reorder: 20 },
  { name: "Salbutamol", brand: "Asthalin", form: "Inhaler", strength: "100 mcg/dose", qty: 18, batchNo: "AS8890", expiresInDays: 260, mrp: 128, cost: 94, gst: 5, mfr: "Cipla", rack: "D-04", reorder: 10 },
  { name: "ORS + Zinc", brand: "Electral", form: "Sachet", strength: "21.8 g", qty: 140, batchNo: "EL3321", expiresInDays: 600, mrp: 22, cost: 15.5, gst: 5, mfr: "FDC", rack: "E-01", reorder: 50 },
  { name: "Povidone Iodine", brand: "Betadine", form: "Tube (Ointment)", strength: "5% w/w", qty: 26, batchNo: "BT1147", expiresInDays: 330, mrp: 96, cost: 68, gst: 12, mfr: "Win-Medicare", rack: "E-03", reorder: 15 },
  { name: "Normal Saline (Sodium Chloride)", brand: "NS IV", form: "IV Fluid", strength: "0.9% w/v — 500 ml", qty: 8, batchNo: "NS6602", expiresInDays: 190, mrp: 42, cost: 29, gst: 12, mfr: "Baxter", rack: "F-01", reorder: 24 },
  { name: "Iron + Folic Acid", brand: "Autrin", form: "Tablet", strength: "100 mg + 1.5 mg", qty: 200, batchNo: "AU2214", expiresInDays: 85, mrp: 4.4, cost: 2.9, gst: 5, mfr: "Pfizer", rack: "C-05", reorder: 80 },
];

export function seedStock(now: Date = new Date()): readonly Batch[] {
  const addedAt = now.toISOString();

  return ROWS.map((row): Batch => {
    const drug = findDrug(row.name);
    return {
      id: randomId(),
      name: row.name,
      brand: row.brand,
      form: row.form,
      strength: row.strength,
      qty: row.qty,
      batchNo: row.batchNo,
      expiry: toDateInput(addDays(row.expiresInDays, now)),
      mrp: row.mrp,
      cost: row.cost,
      gst: row.gst,
      mfr: row.mfr,
      rack: row.rack,
      reorder: row.reorder,
      cls: drug?.cls ?? "",
      sch: (drug?.sch ?? "OTC") as Schedule,
      addedAt,
      addedBy: "System seed",
    };
  });
}
