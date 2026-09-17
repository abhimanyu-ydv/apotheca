import type { AdjustReason } from "@/domain";

export const ADJUST_REASONS: readonly AdjustReason[] = [
  "Correction",
  "Damaged",
  "Expired write-off",
  "Customer return",
  "Supplier return",
  "Internal issue",
];

export type { AdjustReason, Batch, DosageForm } from "@/domain";
