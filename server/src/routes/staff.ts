import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { query, withTransaction } from "../lib/db.ts";
import {
  ROLE_LEVEL,
  authenticate,
  canManage,
  hashPassword,
  requires,
  type RoleName,
} from "../lib/auth.ts";
import { audit } from "../lib/audit.ts";
import { nextStaffId, temporaryPassword } from "../lib/ids.ts";

const ROLES = [
  "Chief Pharmacist",
  "Pharmacist",
  "Doctor",
  "Pharmacy Staff",
  "Nurse",
] as const;

interface StaffRow {
  id: string;
  staff_id: string;
  email: string;
  name: string;
  phone: string;
  department: string;
  role: RoleName;
  must_change_password: boolean;
  active: boolean;
  created_at: Date;
  last_login_at: Date | null;
}

const toJson = (r: StaffRow) => ({
  id: r.id,
  staffId: r.staff_id,
  email: r.email,
  name: r.name,
  phone: r.phone,
  department: r.department,
  role: r.role,
  mustChangePassword: r.must_change_password,
  active: r.active,
  createdAt: r.created_at.toISOString(),
  lastLoginAt: r.last_login_at?.toISOString() ?? null,
});

/**
 * Staff administration.
 *
 * There is no `POST /auth/signup`. The only way an account comes into
 * existence, after the one-time bootstrap, is an administrator calling
 * `POST /staff` — which is guarded by the `manageStaff` capability.
 */
export async function staffRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);

  /* ----------------------------------------------------------------- list */

  app.get("/staff", async (request, reply) => {
    const rows = await query<StaffRow>(
      `SELECT id, staff_id, email, name, phone, department, role,
              must_change_password, active, created_at, last_login_at
         FROM users
        WHERE pharmacy_id = $1
        ORDER BY active DESC, created_at DESC`,
      [request.user!.pharmacyId],
    );
    return reply.send({ staff: rows.map(toJson) });
  });

  /* -------------------------------------------------------------- provision */

  app.post(
    "/staff",
    { preHandler: requires("manageStaff") },
    async (request, reply) => {
      const body = z
        .object({
          name: z.string().min(1),
          email: z.string().email(),
          phone: z.string().default(""),
          department: z.string().default(""),
          role: z.enum(ROLES),
        })
        .parse(request.body);

      const actor = request.user!;
      if (ROLE_LEVEL[body.role] >= ROLE_LEVEL[actor.role]) {
        return reply.code(403).send({
          error: `You cannot issue an account at or above your own level (${actor.role}).`,
        });
      }

      const duplicate = await query(
        "SELECT 1 FROM users WHERE email = $1",
        [body.email],
      );
      if (duplicate.length) {
        return reply
          .code(409)
          .send({ error: "An account already uses that email address." });
      }

      const plain = temporaryPassword();

      const created = await withTransaction(async (client) => {
        const staffId = await nextStaffId(client, body.role);
        const passwordHash = await hashPassword(plain);

        const { rows } = await client.query<StaffRow>(
          `INSERT INTO users
             (pharmacy_id, staff_id, email, name, phone, department, role,
              password_hash, must_change_password, active, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TRUE, TRUE, $9)
           RETURNING id, staff_id, email, name, phone, department, role,
                     must_change_password, active, created_at, last_login_at`,
          [
            actor.pharmacyId,
            staffId,
            body.email,
            body.name,
            body.phone,
            body.department,
            body.role,
            passwordHash,
            actor.id,
          ],
        );

        const user = rows[0]!;
        await audit(client, {
          pharmacyId: actor.pharmacyId,
          actorId: actor.id,
          actorName: actor.name,
          action: "user.provision",
          summary: `Issued ${staffId} to ${body.name} as ${body.role}`,
          meta: { staffId, role: body.role },
          ip: request.ip,
        });

        return user;
      });

      // The only time the password is ever readable. Not stored, not logged.
      return reply.code(201).send({
        user: toJson(created),
        credentials: {
          staffId: created.staff_id,
          temporaryPassword: plain,
        },
      });
    },
  );

  /* --------------------------------------------------------- reset password */

  app.post(
    "/staff/:id/reset-password",
    { preHandler: requires("manageStaff") },
    async (request, reply) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
      const actor = request.user!;

      const rows = await query<StaffRow>(
        "SELECT * FROM users WHERE id = $1 AND pharmacy_id = $2",
        [id, actor.pharmacyId],
      );
      const target = rows[0];
      if (!target) return reply.code(404).send({ error: "Account not found." });
      if (!canManage(actor, target.role))
        return reply
          .code(403)
          .send({ error: "You can only reset accounts below your own level." });

      const plain = temporaryPassword();
      const passwordHash = await hashPassword(plain);

      await withTransaction(async (client) => {
        await client.query(
          `UPDATE users
              SET password_hash = $2, must_change_password = TRUE,
                  failed_attempts = 0, locked_until = NULL
            WHERE id = $1`,
          [id, passwordHash],
        );
        // Kill every live session — the old password is gone as of now.
        await client.query(
          "UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL",
          [id],
        );
        await audit(client, {
          pharmacyId: actor.pharmacyId,
          actorId: actor.id,
          actorName: actor.name,
          action: "user.password_reset",
          summary: `Password reset for ${target.name} (${target.staff_id})`,
          meta: { staffId: target.staff_id },
          ip: request.ip,
        });
      });

      return reply.send({
        credentials: { staffId: target.staff_id, temporaryPassword: plain },
      });
    },
  );

  /* ------------------------------------------------------- activate/suspend */

  app.patch(
    "/staff/:id/active",
    { preHandler: requires("manageStaff") },
    async (request, reply) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
      const body = z
        .object({ active: z.boolean(), reason: z.string().default("") })
        .parse(request.body);
      const actor = request.user!;

      if (id === actor.id)
        return reply.code(400).send({ error: "You cannot disable your own account." });

      const rows = await query<StaffRow>(
        "SELECT * FROM users WHERE id = $1 AND pharmacy_id = $2",
        [id, actor.pharmacyId],
      );
      const target = rows[0];
      if (!target) return reply.code(404).send({ error: "Account not found." });
      if (!canManage(actor, target.role))
        return reply
          .code(403)
          .send({ error: "You can only change accounts below your own level." });

      await withTransaction(async (client) => {
        await client.query("UPDATE users SET active = $2 WHERE id = $1", [id, body.active]);
        if (!body.active) {
          await client.query(
            "UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL",
            [id],
          );
        }
        await audit(client, {
          pharmacyId: actor.pharmacyId,
          actorId: actor.id,
          actorName: actor.name,
          action: body.active ? "user.reactivate" : "user.deactivate",
          summary: `${body.active ? "Reactivated" : "Deactivated"} ${target.name} (${target.staff_id})${body.reason ? ` — ${body.reason}` : ""}`,
          ip: request.ip,
        });
      });

      return reply.code(204).send();
    },
  );

  /* ------------------------------------------------------------ change role */

  app.patch(
    "/staff/:id/role",
    { preHandler: requires("manageStaff") },
    async (request, reply) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
      const body = z.object({ role: z.enum(ROLES) }).parse(request.body);
      const actor = request.user!;

      const rows = await query<StaffRow>(
        "SELECT * FROM users WHERE id = $1 AND pharmacy_id = $2",
        [id, actor.pharmacyId],
      );
      const target = rows[0];
      if (!target) return reply.code(404).send({ error: "Account not found." });
      if (!canManage(actor, target.role) || ROLE_LEVEL[body.role] >= ROLE_LEVEL[actor.role])
        return reply.code(403).send({ error: "That role change is above your level." });
      if (target.role === body.role) return reply.code(204).send();

      const staffId = await withTransaction(async (client) => {
        // The prefix encodes the role, so the ID is reissued to match.
        const newId = await nextStaffId(client, body.role);
        await client.query("UPDATE users SET role = $2, staff_id = $3 WHERE id = $1", [
          id,
          body.role,
          newId,
        ]);
        await client.query(
          "UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL",
          [id],
        );
        await audit(client, {
          pharmacyId: actor.pharmacyId,
          actorId: actor.id,
          actorName: actor.name,
          action: "user.role_change",
          summary: `${target.name}: ${target.role} → ${body.role}, new ID ${newId}`,
          meta: { from: target.role, to: body.role, staffId: newId },
          ip: request.ip,
        });
        return newId;
      });

      return reply.send({ staffId });
    },
  );
}
