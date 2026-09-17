import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import argon2 from "argon2";
import type { FastifyReply, FastifyRequest } from "fastify";

import { query } from "./db.ts";

/**
 * Authentication and role enforcement.
 *
 * Passwords use Argon2id, not the browser's SHA-256. The client-side hashing in
 * the offline build is adequate for a single-machine prototype; once passwords
 * cross a network they need a memory-hard KDF.
 */

const ARGON_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19_456, // 19 MiB — OWASP's minimum recommendation
  timeCost: 2,
  parallelism: 1,
};

export const hashPassword = (plain: string): Promise<string> =>
  argon2.hash(plain, ARGON_OPTIONS);

export async function verifyPassword(
  hash: string,
  plain: string,
): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------- sessions */

export const SESSION_TTL_HOURS = Number(process.env.SESSION_TTL_HOURS ?? 12);

/** The token is returned to the client; only its digest is stored. */
export function issueToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashToken(token) };
}

export const hashToken = (token: string): string =>
  createHash("sha256").update(token).digest("hex");

/** Constant-time compare, for anywhere we match a secret by value. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/* ---------------------------------------------------------------- roles */

export type RoleName =
  | "Chief Pharmacist"
  | "Pharmacist"
  | "Doctor"
  | "Pharmacy Staff"
  | "Nurse";

export interface Capabilities {
  deleteStock: boolean;
  adjustStock: boolean;
  receiveStock: boolean;
  writeOffExpired: boolean;
  returnBill: boolean;
  manageStaff: boolean;
  exportData: boolean;
  writePrescription: boolean;
  fulfilPrescription: boolean;
  viewCost: boolean;
}

const NONE: Capabilities = {
  deleteStock: false,
  adjustStock: false,
  receiveStock: false,
  writeOffExpired: false,
  returnBill: false,
  manageStaff: false,
  exportData: false,
  writePrescription: false,
  fulfilPrescription: false,
  viewCost: false,
};

/**
 * Mirrors `src/domain/roles.ts` on the client.
 *
 * The client copy drives what a user *sees*; this copy decides what the server
 * will actually *do*. A UI that hides a button is a courtesy — this is the
 * enforcement.
 */
export const CAPABILITIES: Record<RoleName, Capabilities> = {
  "Chief Pharmacist": {
    ...NONE,
    deleteStock: true,
    adjustStock: true,
    receiveStock: true,
    writeOffExpired: true,
    returnBill: true,
    manageStaff: true,
    exportData: true,
    fulfilPrescription: true,
    viewCost: true,
  },
  Pharmacist: {
    ...NONE,
    adjustStock: true,
    receiveStock: true,
    writeOffExpired: true,
    returnBill: true,
    exportData: true,
    fulfilPrescription: true,
    viewCost: true,
  },
  Doctor: { ...NONE, writePrescription: true },
  "Pharmacy Staff": {
    ...NONE,
    adjustStock: true,
    receiveStock: true,
    fulfilPrescription: true,
  },
  Nurse: { ...NONE },
};

export const ROLE_LEVEL: Record<RoleName, number> = {
  "Chief Pharmacist": 5,
  Pharmacist: 4,
  Doctor: 3,
  "Pharmacy Staff": 2,
  Nurse: 1,
};

export interface AuthUser {
  id: string;
  pharmacyId: string;
  staffId: string;
  name: string;
  role: RoleName;
  mustChangePassword: boolean;
}

declare module "fastify" {
  interface FastifyRequest {
    user?: AuthUser;
  }
}

interface SessionRow {
  user_id: string;
  pharmacy_id: string;
  staff_id: string;
  name: string;
  role: RoleName;
  must_change_password: boolean;
  active: boolean;
}

/** Resolve the bearer token into a user, or reply 401. */
export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const header = request.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) {
    await reply.code(401).send({ error: "Missing bearer token." });
    return;
  }

  const rows = await query<SessionRow>(
    `SELECT u.id            AS user_id,
            u.pharmacy_id,
            u.staff_id,
            u.name,
            u.role,
            u.must_change_password,
            u.active
       FROM sessions s
       JOIN users    u ON u.id = s.user_id
      WHERE s.token_hash = $1
        AND s.revoked_at IS NULL
        AND s.expires_at > now()`,
    [hashToken(token)],
  );

  const row = rows[0];
  if (!row) {
    await reply.code(401).send({ error: "Session expired. Sign in again." });
    return;
  }
  if (!row.active) {
    await reply.code(403).send({ error: "This account has been deactivated." });
    return;
  }

  request.user = {
    id: row.user_id,
    pharmacyId: row.pharmacy_id,
    staffId: row.staff_id,
    name: row.name,
    role: row.role,
    mustChangePassword: row.must_change_password,
  };
}

/** Guard a route on a capability. Use as a `preHandler` after `authenticate`. */
export function requires(capability: keyof Capabilities) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const user = request.user;
    if (!user) {
      await reply.code(401).send({ error: "Not signed in." });
      return;
    }
    if (!CAPABILITIES[user.role][capability]) {
      await reply.code(403).send({
        error: `Your role (${user.role}) cannot perform this action.`,
        capability,
      });
    }
  };
}

/**
 * Block every write while the user is still on the administrator-issued
 * password. Reading is fine; changing the pharmacy's records is not.
 */
export async function blockIfPasswordChangePending(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (request.user?.mustChangePassword) {
    await reply.code(403).send({
      error: "Set your own password before using the system.",
      code: "PASSWORD_CHANGE_REQUIRED",
    });
  }
}

export const canManage = (actor: AuthUser, targetRole: RoleName): boolean =>
  CAPABILITIES[actor.role].manageStaff &&
  ROLE_LEVEL[actor.role] > ROLE_LEVEL[targetRole];
