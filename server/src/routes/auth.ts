import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { query, withTransaction } from "../lib/db.ts";
import {
  SESSION_TTL_HOURS,
  authenticate,
  hashPassword,
  hashToken,
  issueToken,
  verifyPassword,
  type RoleName,
} from "../lib/auth.ts";
import { audit } from "../lib/audit.ts";
import { nextStaffId } from "../lib/ids.ts";

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

interface UserRow {
  id: string;
  pharmacy_id: string;
  staff_id: string;
  email: string;
  name: string;
  phone: string;
  department: string;
  role: RoleName;
  password_hash: string;
  security_question: string;
  must_change_password: boolean;
  active: boolean;
  failed_attempts: number;
  locked_until: Date | null;
  pharmacy_name?: string;
}

const publicUser = (row: UserRow) => ({
  id: row.id,
  staffId: row.staff_id,
  email: row.email,
  name: row.name,
  phone: row.phone,
  department: row.department,
  role: row.role,
  pharmacy: row.pharmacy_name ?? "",
  pharmacyId: row.pharmacy_id,
  mustChangePassword: row.must_change_password,
  active: row.active,
  securityQuestion: row.security_question,
});

export async function authRoutes(app: FastifyInstance): Promise<void> {
  /* ------------------------------------------------------------ bootstrap */

  /**
   * The one and only self-service account creation. Refuses once any user
   * exists, so it cannot be replayed to mint a second administrator.
   */
  app.post("/auth/bootstrap", async (request, reply) => {
    const body = z
      .object({
        pharmacyName: z.string().min(1),
        gstin: z.string().optional(),
        licenceNo: z.string().optional(),
        name: z.string().min(1),
        email: z.string().email(),
        phone: z.string().default(""),
        password: z.string().min(8),
        securityQuestion: z.string().min(1),
        securityAnswer: z.string().min(1),
      })
      .parse(request.body);

    const existing = await query<{ count: number }>(
      "SELECT COUNT(*)::int AS count FROM users",
    );
    if ((existing[0]?.count ?? 0) > 0) {
      return reply.code(409).send({
        error: "This installation is already set up. Ask an administrator for an account.",
      });
    }

    const result = await withTransaction(async (client) => {
      const { rows: pharmacyRows } = await client.query<{ id: string }>(
        `INSERT INTO pharmacies (name, gstin, licence_no)
         VALUES ($1, $2, $3) RETURNING id`,
        [body.pharmacyName, body.gstin ?? null, body.licenceNo ?? null],
      );
      const pharmacyId = pharmacyRows[0]!.id;

      const staffId = await nextStaffId(client, "Chief Pharmacist");
      const [passwordHash, answerHash] = await Promise.all([
        hashPassword(body.password),
        hashPassword(body.securityAnswer.trim().toLowerCase()),
      ]);

      const { rows } = await client.query<UserRow>(
        `INSERT INTO users
           (pharmacy_id, staff_id, email, name, phone, department, role,
            password_hash, security_question, security_answer_hash,
            must_change_password, active)
         VALUES ($1, $2, $3, $4, $5, 'Pharmacy', 'Chief Pharmacist',
                 $6, $7, $8, FALSE, TRUE)
         RETURNING *`,
        [
          pharmacyId,
          staffId,
          body.email,
          body.name,
          body.phone,
          passwordHash,
          body.securityQuestion,
          answerHash,
        ],
      );

      const user = rows[0]!;
      await audit(client, {
        pharmacyId,
        actorId: user.id,
        actorName: user.name,
        action: "user.provision",
        summary: `${user.name} set up ${body.pharmacyName} as Chief Pharmacist (${staffId})`,
      });

      return { user, pharmacyId, pharmacyName: body.pharmacyName };
    });

    return reply.code(201).send({
      user: publicUser({ ...result.user, pharmacy_name: result.pharmacyName }),
    });
  });

  /* ---------------------------------------------------------------- login */

  app.post("/auth/login", async (request, reply) => {
    const body = z
      .object({ handle: z.string().min(1), password: z.string().min(1) })
      .parse(request.body);

    const handle = body.handle.trim();
    const rows = await query<UserRow>(
      `SELECT u.*, p.name AS pharmacy_name
         FROM users u
         JOIN pharmacies p ON p.id = u.pharmacy_id
        WHERE u.staff_id = $1 OR u.email = $1`,
      [handle],
    );

    const user = rows[0];
    // Same message either way — don't confirm which Staff IDs exist.
    const REJECT = { error: "That Staff ID or password is not recognised." };
    if (!user) return reply.code(401).send(REJECT);

    if (!user.active) {
      return reply
        .code(403)
        .send({ error: "This account has been deactivated. Speak to your administrator." });
    }

    if (user.locked_until && user.locked_until > new Date()) {
      return reply.code(429).send({
        error: `Too many failed attempts. Try again after ${user.locked_until.toLocaleTimeString("en-IN")}.`,
      });
    }

    const ok = await verifyPassword(user.password_hash, body.password);

    if (!ok) {
      await withTransaction(async (client) => {
        const attempts = user.failed_attempts + 1;
        const lock =
          attempts >= MAX_FAILED_ATTEMPTS
            ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000)
            : null;

        await client.query(
          "UPDATE users SET failed_attempts = $2, locked_until = $3 WHERE id = $1",
          [user.id, attempts, lock],
        );
        await audit(client, {
          pharmacyId: user.pharmacy_id,
          actorId: user.id,
          actorName: user.name,
          action: "user.login_failed",
          summary: `Failed sign-in for ${user.staff_id}${lock ? " — account locked" : ""}`,
          ip: request.ip,
        });
      });
      return reply.code(401).send(REJECT);
    }

    const { token, hash } = issueToken();
    const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 3_600_000);

    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO sessions (user_id, token_hash, expires_at, user_agent, ip)
         VALUES ($1, $2, $3, $4, $5)`,
        [user.id, hash, expiresAt, request.headers["user-agent"] ?? null, request.ip],
      );
      await client.query(
        `UPDATE users
            SET last_login_at = now(), failed_attempts = 0, locked_until = NULL
          WHERE id = $1`,
        [user.id],
      );
      await audit(client, {
        pharmacyId: user.pharmacy_id,
        actorId: user.id,
        actorName: user.name,
        action: "user.login",
        summary: `${user.name} signed in (${user.staff_id})`,
        ip: request.ip,
      });
    });

    return reply.send({
      token,
      expiresAt: expiresAt.toISOString(),
      user: publicUser(user),
    });
  });

  /* --------------------------------------------------------------- logout */

  app.post(
    "/auth/logout",
    { preHandler: authenticate },
    async (request, reply) => {
      const header = request.headers.authorization ?? "";
      const token = header.slice(7).trim();

      await withTransaction(async (client) => {
        await client.query(
          "UPDATE sessions SET revoked_at = now() WHERE token_hash = $1",
          [hashToken(token)],
        );
        await audit(client, {
          pharmacyId: request.user!.pharmacyId,
          actorId: request.user!.id,
          actorName: request.user!.name,
          action: "user.logout",
          summary: `${request.user!.name} signed out`,
        });
      });

      return reply.code(204).send();
    },
  );

  /* ------------------------------------------------------------------- me */

  app.get("/auth/me", { preHandler: authenticate }, async (request, reply) => {
    const rows = await query<UserRow>(
      `SELECT u.*, p.name AS pharmacy_name
         FROM users u JOIN pharmacies p ON p.id = u.pharmacy_id
        WHERE u.id = $1`,
      [request.user!.id],
    );
    const user = rows[0];
    if (!user) return reply.code(404).send({ error: "Account not found." });
    return reply.send({ user: publicUser(user) });
  });

  /* ------------------------------------------------------ change password */

  /**
   * Available while `mustChangePassword` is set — it's the only thing such a
   * user is allowed to do.
   */
  app.post(
    "/auth/change-password",
    { preHandler: authenticate },
    async (request, reply) => {
      const body = z
        .object({
          currentPassword: z.string().min(1),
          newPassword: z.string().min(8),
          securityQuestion: z.string().optional(),
          securityAnswer: z.string().optional(),
        })
        .parse(request.body);

      const rows = await query<UserRow>("SELECT * FROM users WHERE id = $1", [
        request.user!.id,
      ]);
      const user = rows[0];
      if (!user) return reply.code(404).send({ error: "Account not found." });

      if (!(await verifyPassword(user.password_hash, body.currentPassword)))
        return reply.code(401).send({ error: "Your current password doesn't match." });

      if (body.currentPassword === body.newPassword)
        return reply
          .code(400)
          .send({ error: "Choose a password different from the issued one." });

      const passwordHash = await hashPassword(body.newPassword);
      const answerHash = body.securityAnswer
        ? await hashPassword(body.securityAnswer.trim().toLowerCase())
        : null;

      await withTransaction(async (client) => {
        await client.query(
          `UPDATE users
              SET password_hash        = $2,
                  must_change_password = FALSE,
                  security_question    = COALESCE(NULLIF($3, ''), security_question),
                  security_answer_hash = COALESCE($4, security_answer_hash)
            WHERE id = $1`,
          [user.id, passwordHash, body.securityQuestion ?? "", answerHash],
        );

        // Every other session for this user dies with the old password.
        await client.query(
          `UPDATE sessions SET revoked_at = now()
            WHERE user_id = $1 AND token_hash <> $2 AND revoked_at IS NULL`,
          [user.id, hashToken((request.headers.authorization ?? "").slice(7).trim())],
        );

        await audit(client, {
          pharmacyId: user.pharmacy_id,
          actorId: user.id,
          actorName: user.name,
          action: "user.password_changed",
          summary: `${user.name} changed their own password`,
        });
      });

      return reply.code(204).send();
    },
  );
}
