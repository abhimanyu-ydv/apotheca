/**
 * Shelf-life arithmetic.
 *
 * `now` is injectable on every function so the rules are testable without
 * mocking the clock, and so a server-side port can pass its own timestamp.
 */

import type { Batch, Instant, IsoDate } from "./types";

const DAY_MS = 86_400_000;

export type ExpiryLevel = "expired" | "critical" | "warning" | "ok";

/** Days-remaining thresholds. Change here, not at the call sites. */
export const EXPIRY_THRESHOLDS = { critical: 30, warning: 90 } as const;

/** Midnight local time, so "days left" never flickers with the hour. */
export function startOfDay(now: Date = new Date()): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function daysUntil(date: IsoDate, now: Date = new Date()): number {
  const target = startOfDay(new Date(date));
  return Math.round((target.getTime() - startOfDay(now).getTime()) / DAY_MS);
}

export interface ExpiryStatus {
  readonly level: ExpiryLevel;
  readonly days: number;
  readonly label: string;
}

export function expiryStatus(date: IsoDate, now: Date = new Date()): ExpiryStatus {
  const days = daysUntil(date, now);
  if (days < 0) return { level: "expired", days, label: "Expired" };
  if (days === 0) return { level: "critical", days, label: "Expires today" };
  if (days <= EXPIRY_THRESHOLDS.critical)
    return { level: "critical", days, label: `${days}d left` };
  if (days <= EXPIRY_THRESHOLDS.warning)
    return { level: "warning", days, label: `${days}d left` };
  return { level: "ok", days, label: `${days}d left` };
}

export const isExpired = (batch: Pick<Batch, "expiry">, now?: Date): boolean =>
  daysUntil(batch.expiry, now) < 0;

export const isDispensable = (batch: Batch, now?: Date): boolean =>
  batch.qty > 0 && !isExpired(batch, now);

/**
 * Fraction of the batch's shelf life still remaining, 0..1. Used for the life
 * bar. Falls back to the received date when the batch predates that field.
 */
export function shelfLifeRemaining(
  batch: Pick<Batch, "expiry" | "addedAt">,
  now: Date = new Date(),
): number {
  const expiry = startOfDay(new Date(batch.expiry)).getTime();
  const received = startOfDay(new Date(batch.addedAt || now)).getTime();
  const total = expiry - received;
  if (total <= 0) return 0;
  const left = expiry - startOfDay(now).getTime();
  return Math.max(0, Math.min(1, left / total));
}

/* -------------------------------------------------------------- formatting */

export function formatDate(value: IsoDate | Instant | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function formatDateTime(value: Instant | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

export function formatTime(value: Instant): string {
  return new Date(value).toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** `YYYY-MM-DD` for `<input type="date">`. */
export function toDateInput(d: Date = new Date()): IsoDate {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function isSameDay(a: Instant | Date, b: Instant | Date): boolean {
  return startOfDay(new Date(a)).getTime() === startOfDay(new Date(b)).getTime();
}

export function addDays(days: number, from: Date = new Date()): Date {
  return new Date(from.getTime() + days * DAY_MS);
}
