/**
 * E-prescriptions.
 *
 * The original build advertised "Doctors write, pharmacy fulfils — full audit
 * trail" on its own login screen, and shipped a `genPrescriptionId` function
 * that nothing ever called. This is that feature, built.
 *
 * Pure domain logic: quantity arithmetic, validation, and matching a
 * prescription against what is actually on the shelf.
 */

import type {
  Batch,
  DosageForm,
  FrequencyCode,
  Prescription,
  PrescriptionItem,
  PrescriptionStatus,
  User,
} from "./types";
import { FREQUENCIES } from "./types";
import { randomId } from "./ids";
import { availableQty, type StockIndex } from "./inventory";

/* ------------------------------------------------------------ quantities */

const PER_DAY = new Map<FrequencyCode, number>(
  FREQUENCIES.map((f) => [f.code, f.perDay]),
);

export function frequencyLabel(code: FrequencyCode): string {
  return FREQUENCIES.find((f) => f.code === code)?.label ?? code;
}

/**
 * Total units to dispense for a line.
 *
 * STAT is a single dose regardless of duration; SOS ("as needed") can't be
 * predicted, so it falls back to one unit per day of cover.
 */
export function computeQty(
  dosePerTake: number,
  frequency: FrequencyCode,
  durationDays: number,
): number {
  const dose = Math.max(0, dosePerTake);
  const days = Math.max(1, Math.trunc(durationDays) || 1);
  if (frequency === "STAT") return Math.ceil(dose);
  return Math.ceil(dose * (PER_DAY.get(frequency) ?? 1) * days);
}

/** Human-readable dosing line for the printed prescription. */
export function doseSummary(item: PrescriptionItem): string {
  const unit = item.dosePerTake === 1 ? "" : ` × ${item.dosePerTake}`;
  if (item.frequency === "STAT") return `STAT${unit} — single dose`;
  if (item.frequency === "SOS") return `SOS${unit} — as needed, ${item.durationDays} day cover`;
  return `${item.frequency}${unit} — ${item.durationDays} day${item.durationDays === 1 ? "" : "s"}`;
}

/* ----------------------------------------------------------- id + build */

export function generatePrescriptionId(
  existing: readonly Prescription[],
  now: Date = new Date(),
): string {
  const head = `RX-${now.getFullYear()}-`;
  let highest = 0;
  for (const rx of existing) {
    if (!rx.id.startsWith(head)) continue;
    const seq = Number.parseInt(rx.id.slice(head.length), 10);
    if (Number.isFinite(seq) && seq > highest) highest = seq;
  }
  return `${head}${String(highest + 1).padStart(5, "0")}`;
}

export function makeItem(input: {
  name: string;
  form: DosageForm;
  strength: string;
  dosePerTake: number;
  frequency: FrequencyCode;
  durationDays: number;
  qty?: number;
  instructions?: string;
}): PrescriptionItem {
  const computed = computeQty(input.dosePerTake, input.frequency, input.durationDays);
  return {
    id: randomId(),
    name: input.name.trim(),
    form: input.form,
    strength: input.strength.trim(),
    dosePerTake: input.dosePerTake,
    frequency: input.frequency,
    durationDays: input.durationDays,
    qty: input.qty && input.qty > 0 ? Math.trunc(input.qty) : computed,
    instructions: (input.instructions ?? "").trim(),
  };
}

export interface PrescriptionDraft {
  readonly patientName: string;
  readonly patientId: string;
  readonly patientAge: string;
  readonly diagnosis: string;
  readonly notes: string;
}

export function buildPrescription(
  draft: PrescriptionDraft,
  items: readonly PrescriptionItem[],
  doctor: User,
  existing: readonly Prescription[],
  now: Date = new Date(),
): Prescription {
  return {
    id: generatePrescriptionId(existing, now),
    at: now.toISOString(),
    doctorId: doctor.id,
    doctorName: doctor.name,
    patientName: draft.patientName.trim(),
    patientId: draft.patientId.trim(),
    patientAge: draft.patientAge.trim(),
    diagnosis: draft.diagnosis.trim(),
    items,
    notes: draft.notes.trim(),
    status: "open",
  };
}

/* -------------------------------------------------------------- validate */

export type Validation = { ok: true } | { ok: false; message: string };

export function validatePrescription(
  draft: PrescriptionDraft,
  items: readonly PrescriptionItem[],
): Validation {
  if (!draft.patientName.trim())
    return { ok: false, message: "Enter the patient's name." };
  if (items.length === 0)
    return { ok: false, message: "Add at least one medicine to the prescription." };
  const bad = items.find((i) => i.qty <= 0);
  if (bad)
    return { ok: false, message: `${bad.name}: quantity must be more than zero.` };
  return { ok: true };
}

/* ---------------------------------------------------- stock availability */

export type FillLevel = "full" | "partial" | "none";

export interface ItemAvailability {
  readonly item: PrescriptionItem;
  /** Dispensable units on the shelf right now, expired batches excluded. */
  readonly available: number;
  readonly shortfall: number;
  readonly level: FillLevel;
}

export interface PrescriptionAvailability {
  readonly lines: readonly ItemAvailability[];
  readonly level: FillLevel;
  readonly shortLines: number;
}

/**
 * Can the counter fill this prescription today? Answered per line so the
 * pharmacist can tell the patient exactly what is missing.
 */
export function checkAvailability(
  prescription: Prescription,
  index: StockIndex,
  now?: Date,
): PrescriptionAvailability {
  const lines = prescription.items.map((item): ItemAvailability => {
    const available = availableQty(index, item, now);
    const shortfall = Math.max(0, item.qty - available);
    return {
      item,
      available,
      shortfall,
      level: shortfall === 0 ? "full" : available > 0 ? "partial" : "none",
    };
  });

  const shortLines = lines.filter((l) => l.shortfall > 0).length;
  const level: FillLevel =
    shortLines === 0 ? "full" : shortLines === lines.length ? "none" : "partial";

  return { lines, level, shortLines };
}

/* ------------------------------------------------------------- lifecycle */

export function markDispensed(
  prescription: Prescription,
  by: User,
  billNo: string,
  now: Date = new Date(),
): Prescription {
  return {
    ...prescription,
    status: "dispensed",
    dispensedAt: now.toISOString(),
    dispensedBy: by.name,
    billNo,
  };
}

export function markCancelled(
  prescription: Prescription,
  reason: string,
  now: Date = new Date(),
): Prescription {
  return {
    ...prescription,
    status: "cancelled",
    cancelledAt: now.toISOString(),
    cancelReason: reason.trim(),
  };
}

/* --------------------------------------------------------------- queries */

export function filterPrescriptions(
  list: readonly Prescription[],
  query: string,
  status: PrescriptionStatus | "All",
): readonly Prescription[] {
  const q = query.trim().toLowerCase();
  return list.filter((rx) => {
    if (status !== "All" && rx.status !== status) return false;
    if (!q) return true;
    return (
      `${rx.id} ${rx.patientName} ${rx.patientId} ${rx.doctorName} ${rx.diagnosis}`
        .toLowerCase()
        .includes(q) || rx.items.some((i) => i.name.toLowerCase().includes(q))
    );
  });
}

/** Open prescriptions, newest first — the counter's work queue. */
export function pendingQueue(
  list: readonly Prescription[],
): readonly Prescription[] {
  return list
    .filter((rx) => rx.status === "open")
    .sort((a, b) => (a.at < b.at ? 1 : -1));
}

/** Batches that would satisfy a prescription line, for the counter's preview. */
export function suggestBatches(
  item: PrescriptionItem,
  index: StockIndex,
): readonly Batch[] {
  return index.byProduct.get(
    `${item.name.toLowerCase()}|${item.form}|${item.strength.toLowerCase()}`,
  ) ?? [];
}
