import type { Client } from "./db.ts";

/**
 * Audit writes go through the same transaction as the change they describe, so
 * a rolled-back bill leaves no orphan log line — and a committed one can never
 * be missing its entry.
 */

export interface AuditInput {
  pharmacyId: string | null;
  actorId: string | null;
  actorName: string;
  action: string;
  summary: string;
  meta?: Record<string, unknown>;
  ip?: string;
}

export async function audit(client: Client, entry: AuditInput): Promise<void> {
  await client.query(
    `INSERT INTO audit_log
       (pharmacy_id, actor_id, actor_name, action, summary, meta, ip)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      entry.pharmacyId,
      entry.actorId,
      entry.actorName,
      entry.action,
      entry.summary,
      entry.meta ? JSON.stringify(entry.meta) : null,
      entry.ip ?? null,
    ],
  );
}

/** Record a quantity change against a batch. Never call this outside a txn. */
export async function recordMovement(
  client: Client,
  m: {
    pharmacyId: string;
    batchId: string | null;
    kind: "receive" | "dispense" | "return" | "adjust" | "writeoff" | "delete";
    delta: number;
    qtyAfter: number | null;
    reason?: string | null;
    note?: string;
    billId?: string | null;
    byUser: string | null;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO stock_movements
       (pharmacy_id, batch_id, kind, delta, qty_after, reason, note, bill_id, by_user)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      m.pharmacyId,
      m.batchId,
      m.kind,
      m.delta,
      m.qtyAfter,
      m.reason ?? null,
      m.note ?? "",
      m.billId ?? null,
      m.byUser,
    ],
  );
}
