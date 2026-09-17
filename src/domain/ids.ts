/**
 * Identifier generation.
 *
 * `randomId` prefers `crypto.randomUUID` where it exists (browsers, Node 19+,
 * React Native with a polyfill) and degrades to a time-ordered fallback, so the
 * domain layer stays runnable anywhere without a platform import.
 */

import type { Bill, Patient } from "./types";

const cryptoRef: Crypto | undefined =
  typeof globalThis !== "undefined" ? (globalThis as { crypto?: Crypto }).crypto : undefined;

export function randomId(): string {
  if (cryptoRef?.randomUUID) return cryptoRef.randomUUID();
  // Time prefix keeps ids roughly sortable, which makes debugging dumps easier.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function randomDigits(len: number): string {
  const max = 10 ** len;
  if (cryptoRef?.getRandomValues) {
    const buf = new Uint32Array(1);
    cryptoRef.getRandomValues(buf);
    return String((buf[0] ?? 0) % max).padStart(len, "0");
  }
  return String(Math.floor(Math.random() * max)).padStart(len, "0");
}

/**
 * Generate a short human-facing id that isn't already taken.
 *
 * The old version looped `while (list.some(...))` — O(n) per attempt against a
 * growing array. This builds the taken-set once, so it stays O(1) per attempt
 * however many records exist.
 */
function uniqueId(taken: ReadonlySet<string>, make: () => string): string {
  for (let i = 0; i < 50; i += 1) {
    const candidate = make();
    if (!taken.has(candidate)) return candidate;
  }
  // Space exhausted or extraordinarily unlucky — fall back to a wider id.
  return `${make()}-${randomId().slice(0, 4).toUpperCase()}`;
}

export function generatePatientId(patients: readonly Patient[]): string {
  const taken = new Set(patients.map((p) => p.id));
  return uniqueId(taken, () => `PAT-${randomDigits(5)}`);
}

/**
 * Sequential invoice number, scoped per calendar year.
 *
 * The old version used `bills.length + 1`, which repeats a number the moment a
 * bill is deleted or the year rolls over. This reads the highest sequence
 * actually issued this year.
 */
export function generateBillNumber(
  bills: readonly Bill[],
  pharmacy: string,
  now: Date = new Date(),
): string {
  const year = now.getFullYear();
  const prefix = (pharmacy || "RX").replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase() || "RX";
  const head = `${prefix}/${year}/`;

  let highest = 0;
  for (const bill of bills) {
    if (!bill.no.startsWith(head)) continue;
    const seq = Number.parseInt(bill.no.slice(head.length), 10);
    if (Number.isFinite(seq) && seq > highest) highest = seq;
  }
  return `${head}${String(highest + 1).padStart(4, "0")}`;
}
