/**
 * Audit trail.
 *
 * New. A pharmacy that dispenses Schedule H drugs has to be able to answer
 * "who changed this quantity, when, and why" — the previous build recorded
 * nothing beyond `addedBy` on the batch itself.
 */

import type { AuditAction, AuditEntry, User } from "./types";
import { randomId } from "./ids";

/** Keep the log bounded so localStorage never fills up on a busy counter. */
export const AUDIT_LIMIT = 2000;

export function makeEntry(
  actor: Pick<User, "id" | "name"> | null,
  action: AuditAction,
  summary: string,
  meta?: AuditEntry["meta"],
  now: Date = new Date(),
): AuditEntry {
  return {
    id: randomId(),
    at: now.toISOString(),
    actorId: actor?.id ?? "system",
    actorName: actor?.name ?? "System",
    action,
    summary,
    ...(meta ? { meta } : {}),
  };
}

/** Newest first — the screen reads it in that order, so don't re-sort later. */
export function append(
  log: readonly AuditEntry[],
  entry: AuditEntry,
): readonly AuditEntry[] {
  const next = [entry, ...log];
  return next.length > AUDIT_LIMIT ? next.slice(0, AUDIT_LIMIT) : next;
}

export function record(
  log: readonly AuditEntry[],
  actor: Pick<User, "id" | "name"> | null,
  action: AuditAction,
  summary: string,
  meta?: AuditEntry["meta"],
  now: Date = new Date(),
): readonly AuditEntry[] {
  return append(log, makeEntry(actor, action, summary, meta, now));
}

export const AUDIT_LABELS: Readonly<Record<AuditAction, string>> = {
  "user.provision": "Account issued",
  "user.login": "Signed in",
  "user.login_failed": "Failed sign-in",
  "user.logout": "Signed out",
  "user.password_reset": "Password reset by admin",
  "user.password_changed": "Password changed",
  "user.deactivate": "Account deactivated",
  "user.reactivate": "Account reactivated",
  "user.role_change": "Role changed",
  "stock.receive": "Stock received",
  "stock.adjust": "Quantity adjusted",
  "stock.delete": "Batch deleted",
  "stock.writeoff": "Expired write-off",
  "bill.issue": "Bill issued",
  "bill.return": "Bill returned",
  "patient.create": "Patient registered",
  "rx.write": "Prescription written",
  "rx.dispense": "Prescription dispensed",
  "rx.cancel": "Prescription cancelled",
  "data.export": "Data exported",
  "data.import": "Data imported",
  "data.wipe": "Data wiped",
};

/** Actions worth flagging in red when scanning the log. */
export const SENSITIVE_ACTIONS: ReadonlySet<AuditAction> = new Set<AuditAction>([
  "stock.delete",
  "stock.writeoff",
  "bill.return",
  "data.wipe",
  "data.import",
  "user.password_reset",
  "user.deactivate",
  "user.role_change",
  "user.login_failed",
  "rx.cancel",
]);

export function filterAudit(
  log: readonly AuditEntry[],
  query: string,
  action: AuditAction | "All",
): readonly AuditEntry[] {
  const q = query.trim().toLowerCase();
  return log.filter((e) => {
    if (action !== "All" && e.action !== action) return false;
    if (!q) return true;
    return (
      e.summary.toLowerCase().includes(q) ||
      e.actorName.toLowerCase().includes(q)
    );
  });
}
