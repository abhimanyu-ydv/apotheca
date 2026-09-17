import type { Feature, RoleDefinition, RoleName, User } from "./types";
import { FEATURES } from "./types";

/**
 * Role definitions — the single source of truth for who may do what.
 *
 * `canView` gates navigation, `canDo` gates individual actions, and both are
 * consulted by the screens themselves, so reaching a screen another way still
 * hits the check.
 *
 * Doctor and Pharmacy Staff previously had almost nothing to do. Doctors now
 * own the prescription pad; Pharmacy Staff can receive deliveries and fulfil
 * prescriptions at the counter. Cost price stays hidden from clinical roles —
 * it's commercially sensitive and irrelevant to prescribing.
 */

const define = (
  name: RoleName,
  label: string,
  blurb: string,
  level: number,
  idPrefix: string,
  colour: string,
  view: readonly Feature[],
  can: Partial<RoleDefinition["can"]>,
): RoleDefinition => ({
  name,
  label,
  blurb,
  level,
  idPrefix,
  colour,
  view: new Set(view),
  can: {
    deleteStock: false,
    adjustStock: false,
    receiveStock: false,
    writeOffExpired: false,
    returnBill: false,
    manageStaff: false,
    exportData: false,
    importData: false,
    wipeData: false,
    writePrescription: false,
    fulfilPrescription: false,
    viewCost: false,
    ...can,
  },
});

export const ROLES: Readonly<Record<RoleName, RoleDefinition>> = {
  "Chief Pharmacist": define(
    "Chief Pharmacist",
    "Chief Pharmacist (Admin)",
    "Full control — staff, stock, pricing, data and the audit trail.",
    5,
    "ADMIN",
    "#0A5C51",
    [...FEATURES],
    {
      deleteStock: true,
      adjustStock: true,
      receiveStock: true,
      writeOffExpired: true,
      returnBill: true,
      manageStaff: true,
      exportData: true,
      importData: true,
      wipeData: true,
      fulfilPrescription: true,
      viewCost: true,
    },
  ),

  Pharmacist: define(
    "Pharmacist",
    "Pharmacist",
    "Runs the counter — dispensing, goods inward, expiry and returns.",
    4,
    "PHARM",
    "#0E7A6B",
    [
      "dashboard",
      "prescriptions",
      "addStock",
      "inventory",
      "billing",
      "bills",
      "expiry",
      "patients",
      "audit",
    ],
    {
      adjustStock: true,
      receiveStock: true,
      writeOffExpired: true,
      returnBill: true,
      exportData: true,
      fulfilPrescription: true,
      viewCost: true,
    },
  ),

  Doctor: define(
    "Doctor",
    "Doctor",
    "Writes e-prescriptions and checks what the pharmacy has in stock.",
    3,
    "DOC",
    "#1D4E89",
    ["dashboard", "prescriptions", "inventory", "patients", "bills"],
    { writePrescription: true },
  ),

  "Pharmacy Staff": define(
    "Pharmacy Staff",
    "Pharmacy Staff",
    "Assists at the counter — billing, receiving stock and filling prescriptions.",
    2,
    "STAFF",
    "#B26A05",
    [
      "dashboard",
      "prescriptions",
      "addStock",
      "inventory",
      "billing",
      "bills",
      "expiry",
      "patients",
    ],
    {
      adjustStock: true,
      receiveStock: true,
      fulfilPrescription: true,
    },
  ),

  Nurse: define(
    "Nurse",
    "Nurse",
    "Checks ward stock availability and looks up patient dispensing history.",
    1,
    "NURSE",
    "#5F7688",
    ["dashboard", "prescriptions", "inventory", "bills", "patients"],
    {},
  ),
};

export const ROLE_LIST: readonly RoleDefinition[] = Object.values(ROLES).sort(
  (a, b) => b.level - a.level,
);

export function roleOf(
  user: Pick<User, "role"> | null | undefined,
): RoleDefinition | null {
  if (!user) return null;
  return ROLES[user.role] ?? null;
}

/** May this user see the given screen at all? */
export function canView(
  user: Pick<User, "role"> | null | undefined,
  feature: Feature,
): boolean {
  return roleOf(user)?.view.has(feature) ?? false;
}

/** May this user perform the given privileged action? */
export function canDo(
  user: Pick<User, "role"> | null | undefined,
  action: keyof RoleDefinition["can"],
): boolean {
  return roleOf(user)?.can[action] ?? false;
}

/** The first screen a user is allowed to land on. */
export function landingFeature(user: Pick<User, "role">): Feature {
  const role = ROLES[user.role];
  // A doctor's home is the prescription pad, not the stock dashboard.
  if (role.can.writePrescription && role.view.has("prescriptions"))
    return "prescriptions";
  return FEATURES.find((f) => role.view.has(f)) ?? "dashboard";
}

/** A user may only administer accounts strictly below their own level. */
export function canManage(actor: User, target: User): boolean {
  if (!canDo(actor, "manageStaff")) return false;
  if (actor.id === target.id) return false;
  return ROLES[actor.role].level > ROLES[target.role].level;
}

export function roleColour(role: RoleName): string {
  return ROLES[role]?.colour ?? "#5F7688";
}

// Honorifics common on Indian hospital staff lists. "Sister" and "Matron" are
// nursing titles, not names.
const TITLES = new Set([
  "dr", "mr", "mrs", "ms", "prof", "sri", "smt", "shri",
  "sister", "sr", "matron", "nurse", "pharm",
]);

/** Greeting name — skips honorifics so "Dr. A. Sharma" greets as "Sharma", not "Dr.". */
export function friendlyName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  const meaningful = parts.filter((p) => {
    const bare = p.toLowerCase().replace(/\./g, "");
    // Drop honorifics and bare initials ("A." in "Dr. A. Sharma").
    return !TITLES.has(bare) && bare.length > 1;
  });
  return meaningful[0] ?? parts[0] ?? fullName;
}
