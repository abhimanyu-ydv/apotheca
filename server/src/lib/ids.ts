import { randomInt } from "node:crypto";
import type { Client } from "./db.ts";
import type { RoleName } from "./auth.ts";

const PREFIX: Record<RoleName, string> = {
  "Chief Pharmacist": "ADMIN",
  Pharmacist: "PHARM",
  Doctor: "DOC",
  "Pharmacy Staff": "STAFF",
  Nurse: "NURSE",
};

/**
 * Staff IDs, prescription numbers and invoice numbers are all allocated inside
 * the caller's transaction, so two concurrent requests can't collide. The
 * `UNIQUE` constraints in the schema are the backstop if they ever do.
 */

export async function nextStaffId(
  client: Client,
  role: RoleName,
): Promise<string> {
  const prefix = PREFIX[role];
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const candidate = `${prefix}-${String(randomInt(100_000)).padStart(5, "0")}`;
    const { rowCount } = await client.query(
      "SELECT 1 FROM users WHERE staff_id = $1",
      [candidate],
    );
    if (!rowCount) return candidate;
  }
  throw new Error(`Could not allocate a Staff ID for ${role}.`);
}

/**
 * `CIT/2026/0004` — per pharmacy, per calendar year.
 *
 * Locks the pharmacy row first so two tills can't be handed the same number.
 * The prototype used `bills.length + 1`, which repeats after any deletion.
 */
export async function nextBillNumber(
  client: Client,
  pharmacyId: string,
  pharmacyName: string,
): Promise<string> {
  await client.query("SELECT id FROM pharmacies WHERE id = $1 FOR UPDATE", [
    pharmacyId,
  ]);

  const year = new Date().getFullYear();
  const prefix =
    (pharmacyName.replace(/[^A-Za-z]/g, "").slice(0, 3) || "RX").toUpperCase();
  const head = `${prefix}/${year}/`;

  const { rows } = await client.query<{ seq: number | null }>(
    `SELECT MAX(CAST(NULLIF(regexp_replace(bill_no, '^.*/', ''), '') AS INTEGER)) AS seq
       FROM bills
      WHERE pharmacy_id = $1
        AND bill_no LIKE $2`,
    [pharmacyId, `${head}%`],
  );

  const next = (rows[0]?.seq ?? 0) + 1;
  return `${head}${String(next).padStart(4, "0")}`;
}

export async function nextPrescriptionId(
  client: Client,
  pharmacyId: string,
): Promise<string> {
  const year = new Date().getFullYear();
  const head = `RX-${year}-`;

  const { rows } = await client.query<{ seq: number | null }>(
    `SELECT MAX(CAST(NULLIF(regexp_replace(id, '^RX-[0-9]{4}-', ''), '') AS INTEGER)) AS seq
       FROM prescriptions
      WHERE pharmacy_id = $1
        AND id LIKE $2`,
    [pharmacyId, `${head}%`],
  );

  const next = (rows[0]?.seq ?? 0) + 1;
  return `${head}${String(next).padStart(5, "0")}`;
}

export async function nextPatientId(client: Client): Promise<string> {
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const candidate = `PAT-${String(randomInt(100_000)).padStart(5, "0")}`;
    const { rowCount } = await client.query(
      "SELECT 1 FROM patients WHERE id = $1",
      [candidate],
    );
    if (!rowCount) return candidate;
  }
  throw new Error("Could not allocate a patient ID.");
}

// Excludes look-alike characters — these get written on paper and read back.
const ALPHABET = "abcdefghjkmnpqrstuvwxyz";
const DIGITS = "23456789";

function block(length: number): string {
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out +=
      randomInt(3) === 0
        ? DIGITS[randomInt(DIGITS.length)]
        : ALPHABET[randomInt(ALPHABET.length)];
  }
  return out;
}

export const temporaryPassword = (): string => `Rx-${block(4)}-${block(4)}`;
