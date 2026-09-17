/**
 * Account provisioning.
 *
 * There is no public sign-up. Exactly one account is ever self-created — the
 * Chief Pharmacist, during first-run bootstrap. Everybody else is issued a
 * Staff ID and a temporary password by an administrator, and is forced to
 * replace that password the first time they sign in.
 *
 * This is the model a hospital actually needs: a pharmacy licence is held by a
 * named person, and "anyone with the URL can create a Pharmacist account" is
 * not a defensible position in front of a drug inspector.
 */

import type { RoleName, User } from "./types";
import { ROLES } from "./roles";

/* ------------------------------------------------------------ staff ids */

const cryptoRef: Crypto | undefined =
  typeof globalThis !== "undefined"
    ? (globalThis as { crypto?: Crypto }).crypto
    : undefined;

function randomInt(maxExclusive: number): number {
  if (cryptoRef?.getRandomValues) {
    const buf = new Uint32Array(1);
    cryptoRef.getRandomValues(buf);
    return (buf[0] ?? 0) % maxExclusive;
  }
  return Math.floor(Math.random() * maxExclusive);
}

/**
 * `ADMIN-04213`, `DOC-88120`, … Unique across the whole staff list, not just
 * within the role, so a Staff ID alone identifies a person.
 */
export function issueStaffId(role: RoleName, users: readonly User[]): string {
  const prefix = ROLES[role]?.idPrefix ?? "USR";
  const taken = new Set(users.map((u) => u.staffId));

  for (let attempt = 0; attempt < 50; attempt += 1) {
    const candidate = `${prefix}-${String(randomInt(100000)).padStart(5, "0")}`;
    if (!taken.has(candidate)) return candidate;
  }
  // Space effectively exhausted — widen rather than loop forever.
  return `${prefix}-${String(randomInt(100000)).padStart(5, "0")}-${String(users.length)}`;
}

/* ---------------------------------------------------- temporary password */

// Deliberately excludes look-alikes (0/O, 1/l/I) — these get written on paper
// and read back by someone else.
const ALPHABET = "abcdefghjkmnpqrstuvwxyz";
const DIGITS = "23456789";

function pick(source: string): string {
  return source[randomInt(source.length)] ?? source[0]!;
}

function block(length: number): string {
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += randomInt(3) === 0 ? pick(DIGITS) : pick(ALPHABET);
  }
  return out;
}

/**
 * A password the administrator can read aloud down a corridor: `Rx-k7pq-m3xn`.
 * Long enough to be safe for the few minutes it's meant to live, since the
 * holder must replace it on first sign-in.
 */
export function issueTemporaryPassword(): string {
  return `Rx-${block(4)}-${block(4)}`;
}

/* ------------------------------------------------------------ validation */

export type AccountCheck = { ok: true } | { ok: false; message: string };

export function validateNewStaff(
  input: { name: string; email: string; role: RoleName },
  users: readonly User[],
): AccountCheck {
  if (!input.name.trim()) return { ok: false, message: "Enter the person's full name." };
  if (!/^\S+@\S+\.\S+$/.test(input.email.trim()))
    return { ok: false, message: "That email address doesn't look right." };

  const email = input.email.trim().toLowerCase();
  if (users.some((u) => u.email.toLowerCase() === email))
    return { ok: false, message: "An account already uses that email address." };

  return { ok: true };
}

/** Rules for a password a user chooses for themselves. */
export function validatePassword(pw: string, confirm: string): AccountCheck {
  if (pw.length < 8) return { ok: false, message: "Password needs at least 8 characters." };
  if (!/[a-zA-Z]/.test(pw) || !/\d/.test(pw))
    return { ok: false, message: "Use at least one letter and one number." };
  if (pw !== confirm) return { ok: false, message: "The two passwords don't match." };
  return { ok: true };
}

/* -------------------------------------------------------- normalisation */

/**
 * Fill in fields that accounts written by older builds (or restored from an
 * older backup) don't have. Those records predate Staff IDs, so without this
 * `staffId` is `undefined` and the sign-in screen crashes on the first
 * keystroke. Returns the same array when nothing needed fixing.
 */
export function normaliseUsers(users: readonly Partial<User>[]): User[] {
  let changed = false;
  const out: User[] = [];

  for (const raw of users) {
    const role = (
      (raw.role as string) === "Admin" ? "Chief Pharmacist" : raw.role
    ) as RoleName;
    const knownRole: RoleName = ROLES[role] ? role : "Pharmacy Staff";

    const user: User = {
      ...raw,
      id: raw.id ?? `u-${Date.now().toString(36)}-${out.length}`,
      staffId: raw.staffId || issueStaffId(knownRole, out),
      name: raw.name ?? "",
      email: raw.email ?? "",
      phone: raw.phone ?? "",
      department: raw.department ?? "",
      pharmacy: raw.pharmacy ?? "",
      role: knownRole,
      salt: raw.salt ?? "",
      passwordHash: raw.passwordHash ?? "",
      securityQuestion: raw.securityQuestion ?? "",
      securityAnswerHash: raw.securityAnswerHash ?? "",
      mustChangePassword: raw.mustChangePassword ?? false,
      active: raw.active ?? true,
      createdAt: raw.createdAt ?? new Date().toISOString(),
      createdBy: raw.createdBy ?? "",
      lastLoginAt: raw.lastLoginAt ?? null,
    };

    if ((Object.keys(user) as (keyof User)[]).some((k) => user[k] !== raw[k]))
      changed = true;
    out.push(user);
  }

  return changed ? out : (users as User[]);
}

/* --------------------------------------------------------------- lookup */

/** Staff sign in with either their Staff ID or their email address. */
export function findByHandle(
  users: readonly User[],
  handle: string,
): User | undefined {
  const needle = handle.trim().toLowerCase();
  if (!needle) return undefined;
  return users.find(
    (u) =>
      (u.staffId ?? "").toLowerCase() === needle ||
      (u.email ?? "").toLowerCase() === needle,
  );
}

/** Printable handover slip for the credentials an admin just issued. */
export function credentialSlip(
  user: User,
  temporaryPassword: string,
  now: Date = new Date(),
): string {
  return [
    `${user.pharmacy.toUpperCase()} — STAFF ACCOUNT`,
    ``,
    `Name        ${user.name}`,
    `Role        ${user.role}`,
    user.department ? `Department  ${user.department}` : null,
    ``,
    `Staff ID    ${user.staffId}`,
    `Email       ${user.email}`,
    `Password    ${temporaryPassword}`,
    ``,
    `Sign in with the Staff ID or the email address.`,
    `You will be asked to choose your own password immediately.`,
    `This slip should be destroyed once that is done.`,
    ``,
    `Issued ${now.toLocaleString("en-IN")}`,
  ]
    .filter((line) => line !== null)
    .join("\n");
}
