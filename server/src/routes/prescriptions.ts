import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { query, withTransaction } from "../lib/db.ts";
import {
  authenticate,
  blockIfPasswordChangePending,
  requires,
} from "../lib/auth.ts";
import { audit } from "../lib/audit.ts";
import { nextPrescriptionId } from "../lib/ids.ts";

const FREQUENCIES = ["OD", "BD", "TDS", "QID", "HS", "SOS", "STAT"] as const;

export async function prescriptionRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);

  /* ---------------------------------------------------------------- list */

  /**
   * Doctors see their own pad; the counter sees the whole queue. Enforced here,
   * not just in the UI.
   */
  app.get("/prescriptions", async (request, reply) => {
    const q = z
      .object({ status: z.enum(["open", "dispensed", "cancelled"]).optional() })
      .parse(request.query);

    const actor = request.user!;
    const ownOnly = actor.role === "Doctor";

    const rows = await query(
      `SELECT p.id, p.written_at AS "writtenAt", p.patient_name AS "patientName",
              p.patient_ref AS "patientId", p.patient_age AS "patientAge",
              p.diagnosis, p.notes, p.status,
              p.dispensed_at AS "dispensedAt", p.cancel_reason AS "cancelReason",
              d.name AS "doctorName", d.id AS "doctorId", d.department,
              b.bill_no AS "billNo",
              COALESCE(json_agg(
                json_build_object(
                  'id', i.id, 'name', i.name, 'form', i.form, 'strength', i.strength,
                  'dosePerTake', i.dose_per_take, 'frequency', i.frequency,
                  'durationDays', i.duration_days, 'qty', i.qty,
                  'instructions', i.instructions,
                  'available', COALESCE(a.on_hand, 0)
                ) ORDER BY i.line_no
              ) FILTER (WHERE i.id IS NOT NULL), '[]') AS items
         FROM prescriptions p
         JOIN users d ON d.id = p.doctor_id
         LEFT JOIN bills b ON b.id = p.bill_id
         LEFT JOIN prescription_items i ON i.prescription_id = p.id
         LEFT JOIN product_availability a
                ON a.pharmacy_id = p.pharmacy_id
               AND lower(a.name) = lower(i.name)
               AND a.form = i.form
               AND lower(a.strength) = lower(i.strength)
        WHERE p.pharmacy_id = $1
          AND ($2::text IS NULL OR p.status::text = $2)
          AND (NOT $3::boolean OR p.doctor_id = $4)
        GROUP BY p.id, d.name, d.id, d.department, b.bill_no
        ORDER BY p.written_at DESC
        LIMIT 500`,
      [actor.pharmacyId, q.status ?? null, ownOnly, actor.id],
    );

    return reply.send({ prescriptions: rows });
  });

  /* --------------------------------------------------------------- write */

  app.post(
    "/prescriptions",
    { preHandler: [blockIfPasswordChangePending, requires("writePrescription")] },
    async (request, reply) => {
      const body = z
        .object({
          patientName: z.string().min(1),
          patientRef: z.string().nullish(),
          patientAge: z.string().default(""),
          diagnosis: z.string().default(""),
          notes: z.string().default(""),
          items: z
            .array(
              z.object({
                name: z.string().min(1),
                form: z.string().min(1),
                strength: z.string().min(1),
                dosePerTake: z.number().positive(),
                frequency: z.enum(FREQUENCIES),
                durationDays: z.number().int().positive(),
                qty: z.number().int().positive(),
                instructions: z.string().default(""),
              }),
            )
            .min(1),
        })
        .parse(request.body);

      const actor = request.user!;

      const created = await withTransaction(async (client) => {
        const id = await nextPrescriptionId(client, actor.pharmacyId);

        await client.query(
          `INSERT INTO prescriptions
             (id, pharmacy_id, doctor_id, patient_name, patient_ref,
              patient_age, diagnosis, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            id, actor.pharmacyId, actor.id, body.patientName,
            body.patientRef ?? null, body.patientAge, body.diagnosis, body.notes,
          ],
        );

        let lineNo = 0;
        for (const item of body.items) {
          lineNo += 1;
          await client.query(
            `INSERT INTO prescription_items
               (prescription_id, line_no, name, form, strength,
                dose_per_take, frequency, duration_days, qty, instructions)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
            [
              id, lineNo, item.name, item.form, item.strength,
              item.dosePerTake, item.frequency, item.durationDays,
              item.qty, item.instructions,
            ],
          );
        }

        await audit(client, {
          pharmacyId: actor.pharmacyId,
          actorId: actor.id,
          actorName: actor.name,
          action: "rx.write",
          summary: `${id} for ${body.patientName} — ${body.items.length} medicine(s)`,
          meta: { rx: id, items: body.items.length },
          ip: request.ip,
        });

        return id;
      });

      return reply.code(201).send({ id: created });
    },
  );

  /* -------------------------------------------------------------- cancel */

  app.post(
    "/prescriptions/:id/cancel",
    { preHandler: blockIfPasswordChangePending },
    async (request, reply) => {
      const { id } = z.object({ id: z.string() }).parse(request.params);
      const body = z.object({ reason: z.string().min(1) }).parse(request.body);
      const actor = request.user!;

      const rows = await query<{ doctor_id: string; status: string; patient_name: string }>(
        "SELECT doctor_id, status, patient_name FROM prescriptions WHERE id = $1 AND pharmacy_id = $2",
        [id, actor.pharmacyId],
      );
      const rx = rows[0];
      if (!rx) return reply.code(404).send({ error: "Prescription not found." });
      if (rx.status !== "open")
        return reply.code(409).send({ error: `That prescription is already ${rx.status}.` });

      // The prescriber can withdraw their own; the counter can cancel any.
      const mayCancel =
        rx.doctor_id === actor.id ||
        actor.role === "Pharmacist" ||
        actor.role === "Chief Pharmacist";
      if (!mayCancel)
        return reply.code(403).send({ error: "Only the prescriber or a pharmacist can cancel this." });

      await withTransaction(async (client) => {
        await client.query(
          `UPDATE prescriptions
              SET status = 'cancelled', cancelled_at = now(), cancel_reason = $2
            WHERE id = $1`,
          [id, body.reason],
        );
        await audit(client, {
          pharmacyId: actor.pharmacyId,
          actorId: actor.id,
          actorName: actor.name,
          action: "rx.cancel",
          summary: `Cancelled ${id} (${rx.patient_name}) — ${body.reason}`,
          meta: { rx: id },
          ip: request.ip,
        });
      });

      return reply.code(204).send();
    },
  );
}
