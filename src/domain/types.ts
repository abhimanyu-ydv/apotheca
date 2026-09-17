/**
 * Domain entities.
 *
 * Nothing in `src/domain` may import React, touch `window`, or reach for a
 * browser API. That rule is what makes this folder liftable into a React Native
 * app, an Electron main process, or a Node backend without edits.
 */

/** ISO-8601 instant, e.g. `2026-08-15T09:30:00.000Z`. */
export type Instant = string;
/** Calendar date, `YYYY-MM-DD`. No timezone. */
export type IsoDate = string;

/* ------------------------------------------------------------------ roles */

export const ROLE_NAMES = [
  "Chief Pharmacist",
  "Pharmacist",
  "Doctor",
  "Pharmacy Staff",
  "Nurse",
] as const;

export type RoleName = (typeof ROLE_NAMES)[number];

export const FEATURES = [
  "dashboard",
  "prescriptions",
  "addStock",
  "inventory",
  "billing",
  "bills",
  "expiry",
  "patients",
  "audit",
  "staff",
  "settings",
] as const;

export type Feature = (typeof FEATURES)[number];

/** What a role may do. `view` gates the nav entry; the rest gate actions. */
export interface RoleDefinition {
  readonly name: RoleName;
  readonly label: string;
  /** Higher wins. Used for "can this user act on that user" checks. */
  readonly level: number;
  readonly idPrefix: string;
  readonly colour: string;
  readonly view: ReadonlySet<Feature>;
  /** One-line description of the job, shown on the sign-in role picker. */
  readonly blurb: string;
  /** Destructive or privileged actions, gated independently of `view`. */
  readonly can: {
    readonly deleteStock: boolean;
    readonly adjustStock: boolean;
    readonly receiveStock: boolean;
    readonly writeOffExpired: boolean;
    readonly returnBill: boolean;
    readonly manageStaff: boolean;
    readonly exportData: boolean;
    readonly importData: boolean;
    readonly wipeData: boolean;
    /** Write an e-prescription. Doctors only. */
    readonly writePrescription: boolean;
    /** Turn a prescription into a bill at the counter. */
    readonly fulfilPrescription: boolean;
    /** See purchase cost and margin — commercially sensitive. */
    readonly viewCost: boolean;
  };
}

/* ------------------------------------------------------------------ users */

export interface User {
  readonly id: string;
  /**
   * Login handle issued by the administrator, e.g. `PHARM-04213`.
   * Staff sign in with this or their email — they never choose it themselves.
   */
  readonly staffId: string;
  readonly name: string;
  readonly email: string;
  readonly phone: string;
  /** Ward or department. Shown on prescriptions a doctor writes. */
  readonly department: string;
  readonly pharmacy: string;
  readonly role: RoleName;
  readonly salt: string;
  readonly passwordHash: string;
  readonly securityQuestion: string;
  readonly securityAnswerHash: string;
  /** True until the user replaces the password the administrator issued. */
  readonly mustChangePassword: boolean;
  readonly active: boolean;
  readonly createdAt: Instant;
  /** User id of the administrator who provisioned this account. */
  readonly createdBy: string;
  readonly lastLoginAt: Instant | null;
}

/** What the admin fills in when provisioning an account. */
export interface NewStaffInput {
  readonly name: string;
  readonly email: string;
  readonly phone: string;
  readonly department: string;
  readonly role: RoleName;
}

/** Shown to the administrator once, immediately after provisioning. */
export interface IssuedCredentials {
  readonly user: User;
  readonly staffId: string;
  readonly temporaryPassword: string;
}

/* ------------------------------------------------------------------ stock */

export type DosageForm =
  | "Tablet"
  | "Capsule"
  | "Syrup"
  | "Injection"
  | "Tube (Cream)"
  | "Tube (Gel)"
  | "Tube (Ointment)"
  | "Eye/Ear Drops"
  | "Inhaler"
  | "Respule"
  | "Sachet"
  | "Solution"
  | "IV Fluid";

export type Schedule = "OTC" | "H" | "H1" | "X";

export type GstRate = 0 | 5 | 12 | 18;

/**
 * A physical batch on the shelf. The unit of stock is the *batch*, never the
 * drug — expiry, cost and batch number all belong to the batch, and dispensing
 * the wrong batch is the mistake this whole system exists to prevent.
 */
export interface Batch {
  readonly id: string;
  readonly name: string;
  readonly brand: string;
  readonly form: DosageForm;
  readonly strength: string;
  readonly qty: number;
  readonly batchNo: string;
  readonly expiry: IsoDate;
  /** Selling price per unit, GST-inclusive (Indian MRP convention). */
  readonly mrp: number;
  /** Purchase price per unit, for valuation and write-off loss. */
  readonly cost: number;
  readonly gst: GstRate;
  readonly mfr: string;
  readonly rack: string;
  readonly reorder: number;
  readonly cls: string;
  readonly sch: Schedule;
  readonly addedAt: Instant;
  readonly addedBy: string;
}

/** Identity of a sellable product — a batch belongs to exactly one of these. */
export interface ProductKey {
  readonly name: string;
  readonly form: DosageForm;
  readonly strength: string;
}

/* --------------------------------------------------------------- billing */

export interface BillLine {
  readonly batchId: string;
  readonly name: string;
  readonly brand: string;
  readonly form: DosageForm;
  readonly strength: string;
  readonly batchNo: string;
  readonly expiry: IsoDate;
  readonly mrp: number;
  readonly gst: GstRate;
  readonly qty: number;
}

export type PaymentMode =
  | "Cash"
  | "UPI"
  | "GPay"
  | "Paytm"
  | "Debit Card"
  | "Credit Card"
  | "Net Banking"
  | "Insurance"
  | "Other";

export type BillStatus = "issued" | "returned";

export interface Bill {
  readonly id: string;
  readonly no: string;
  readonly at: Instant;
  readonly patientName: string;
  readonly patientId: string;
  readonly doctor: string;
  readonly pay: PaymentMode;
  readonly payRef: string;
  readonly byUserId: string;
  readonly byName: string;
  readonly pharmacy: string;
  readonly lines: readonly BillLine[];
  readonly taxable: number;
  readonly gstTotal: number;
  readonly discountPct: number;
  readonly discountAmt: number;
  readonly net: number;
  readonly status: BillStatus;
  readonly returnedAt?: Instant;
  readonly returnedBy?: string;
  readonly returnReason?: string;
}

/* -------------------------------------------------------------- patients */

export interface Patient {
  readonly id: string;
  readonly name: string;
  readonly phone: string;
  readonly age: string;
  readonly sex: "M" | "F" | "O" | "";
  readonly notes: string;
  readonly createdAt: Instant;
}

/* --------------------------------------------------- e-prescriptions */

/**
 * Indian prescribing shorthand. Doses per day are used to compute the total
 * quantity to dispense, so the counter doesn't have to do the arithmetic.
 */
export const FREQUENCIES = [
  { code: "OD", label: "OD — once daily", perDay: 1 },
  { code: "BD", label: "BD — twice daily", perDay: 2 },
  { code: "TDS", label: "TDS — three times daily", perDay: 3 },
  { code: "QID", label: "QID — four times daily", perDay: 4 },
  { code: "HS", label: "HS — at bedtime", perDay: 1 },
  { code: "SOS", label: "SOS — as needed", perDay: 1 },
  { code: "STAT", label: "STAT — immediately, once", perDay: 1 },
] as const;

export type FrequencyCode = (typeof FREQUENCIES)[number]["code"];

export interface PrescriptionItem {
  readonly id: string;
  readonly name: string;
  readonly form: DosageForm;
  readonly strength: string;
  /** Units per dose, e.g. 1 tablet or 2 puffs. */
  readonly dosePerTake: number;
  readonly frequency: FrequencyCode;
  readonly durationDays: number;
  /** Total units to dispense. Computed, but the doctor can override. */
  readonly qty: number;
  readonly instructions: string;
}

export type PrescriptionStatus = "open" | "dispensed" | "cancelled";

export interface Prescription {
  readonly id: string;
  readonly at: Instant;
  readonly doctorId: string;
  readonly doctorName: string;
  readonly patientName: string;
  readonly patientId: string;
  readonly patientAge: string;
  readonly diagnosis: string;
  readonly items: readonly PrescriptionItem[];
  readonly notes: string;
  readonly status: PrescriptionStatus;
  readonly dispensedAt?: Instant;
  readonly dispensedBy?: string;
  readonly billNo?: string;
  readonly cancelledAt?: Instant;
  readonly cancelReason?: string;
}

/* ----------------------------------------------------------- audit trail */

export type AuditAction =
  | "user.provision"
  | "user.login"
  | "user.login_failed"
  | "user.logout"
  | "user.password_reset"
  | "user.password_changed"
  | "user.deactivate"
  | "user.reactivate"
  | "user.role_change"
  | "stock.receive"
  | "stock.adjust"
  | "stock.delete"
  | "stock.writeoff"
  | "bill.issue"
  | "bill.return"
  | "patient.create"
  | "rx.write"
  | "rx.dispense"
  | "rx.cancel"
  | "data.export"
  | "data.import"
  | "data.wipe";

/** Reason codes for a manual quantity change. Pharmacies get audited on these. */
export type AdjustReason =
  | "Correction"
  | "Damaged"
  | "Expired write-off"
  | "Customer return"
  | "Supplier return"
  | "Internal issue";

export interface AuditEntry {
  readonly id: string;
  readonly at: Instant;
  readonly actorId: string;
  readonly actorName: string;
  readonly action: AuditAction;
  /** Human-readable one-liner, already formatted for display. */
  readonly summary: string;
  /** Optional structured payload — kept loose so new actions need no migration. */
  readonly meta?: Readonly<Record<string, string | number | boolean | null>>;
}

/* ----------------------------------------------------------- persistence */

/** Everything the app owns, in one serialisable shape. Used for backup/restore. */
export interface Snapshot {
  readonly version: number;
  readonly users: readonly User[];
  readonly stock: readonly Batch[];
  readonly bills: readonly Bill[];
  readonly patients: readonly Patient[];
  readonly prescriptions: readonly Prescription[];
  readonly audit: readonly AuditEntry[];
  readonly exportedAt: Instant;
}
