import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { query, withTransaction } from "../lib/db.ts";
import {
  authenticate,
  blockIfPasswordChangePending,
  requires,
  CAPABILITIES,
} from "../lib/auth.ts";
import { audit, recordMovement } from "../lib/audit.ts";

const ADJUST_REASONS = [
  "Correction",
  "Damaged",
  "Expired write-off",
  "Customer return",
  "Supplier return",
  "Internal issue",
] as const;

export async function stockRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);

  /* ---------------------------------------------------------------- list */

  app.get("/stock", async (request, reply) => {
    const q = z
      .object({
        search: z.string().optional(),
        form: z.string().optional(),
        dispensableOnly: z.coerce.boolean().default(false),
      })
      .parse(request.query);

    // Cost and margin are commercially sensitive; clinical roles get MRP only.
    const seesCost = CAPABILITIES[request.user!.role].viewCost;

    const rows = await query(
      `SELECT id, name, brand, form, strength, batch_no AS "batchNo",
              expiry, qty, mrp, gst, mfr, rack,
              reorder_level AS "reorder", drug_class AS "cls", schedule AS "sch",
              added_at AS "addedAt",
              ${seesCost ? "cost" : "NULL::numeric AS cost"},
              (expiry - CURRENT_DATE) AS "daysLeft"
         FROM batches
        WHERE pharmacy_id = $1
          AND ($2::text IS NULL OR
               name ILIKE '%'||$2||'%' OR brand ILIKE '%'||$2||'%' OR
               batch_no ILIKE '%'||$2||'%' OR mfr ILIKE '%'||$2||'%')
          AND ($3::text IS NULL OR form = $3)
          AND (NOT $4::boolean OR (qty > 0 AND expiry >= CURRENT_DATE))
        ORDER BY expiry ASC`,
      [request.user!.pharmacyId, q.search ?? null, q.form ?? null, q.dispensableOnly],
    );

    return reply.send({ stock: rows });
  });

  /* ------------------------------------------------------- FEFO allocation */

  /**
   * Ask the database which batches to dispense for a quantity of a product.
   *
   * Doing this server-side means the counter, a future mobile till and any
   * integration all follow the same first-expiry-first-out rule.
   */
  app.get("/stock/allocate", async (request, reply) => {
    const q = z
      .object({
        name: z.string().min(1),
        form: z.string().min(1),
        strength: z.string().min(1),
        qty: z.coerce.number().int().positive(),
      })
      .parse(request.query);

    const rows = await query<{ id: string; batch_no: string; expiry: string; qty: number; mrp: string }>(
      `SELECT id, batch_no, expiry, qty, mrp
         FROM batches
        WHERE pharmacy_id = $1
          AND lower(name) = lower($2) AND form = $3 AND lower(strength) = lower($4)
          AND qty > 0 AND expiry >= CURRENT_DATE
        ORDER BY expiry ASC, id ASC`,
      [request.user!.pharmacyId, q.name, q.form, q.strength],
    );

    let remaining = q.qty;
    const allocation: Array<{ batchId: string; batchNo: string; expiry: string; qty: number }> = [];

    for (const row of rows) {
      if (remaining <= 0) break;
      const take = Math.min(row.qty, remaining);
      allocation.push({ batchId: row.id, batchNo: row.batch_no, expiry: row.expiry, qty: take });
      remaining -= take;
    }

    return reply.send({ allocation, shortfall: remaining });
  });

  /* ------------------------------------------------------------- receive */

  app.post(
    "/stock",
    { preHandler: [blockIfPasswordChangePending, requires("receiveStock")] },
    async (request, reply) => {
      const body = z
        .object({
          batches: z
            .array(
              z.object({
                name: z.string().min(1),
                brand: z.string().default(""),
                form: z.string().min(1),
                strength: z.string().min(1),
                batchNo: z.string().min(1),
                expiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
                qty: z.number().int().positive(),
                mrp: z.number().nonnegative(),
                cost: z.number().nonnegative().default(0),
                gst: z.union([z.literal(0), z.literal(5), z.literal(12), z.literal(18)]),
                mfr: z.string().default(""),
                rack: z.string().default(""),
                reorder: z.number().int().nonnegative().default(0),
                cls: z.string().default(""),
                sch: z.string().default("OTC"),
              }),
            )
            .min(1),
        })
        .parse(request.body);

      const actor = request.user!;
      const today = new Date().toISOString().slice(0, 10);
      const expired = body.batches.find((b) => b.expiry < today);
      if (expired)
        return reply.code(422).send({
          error: `${expired.name} batch ${expired.batchNo} is already expired (${expired.expiry}).`,
        });

      try {
        const created = await withTransaction(async (client) => {
          const ids: string[] = [];
          for (const b of body.batches) {
            const { rows } = await client.query<{ id: string }>(
              `INSERT INTO batches
                 (pharmacy_id, name, brand, form, strength, batch_no, expiry, qty,
                  mrp, cost, gst, mfr, rack, reorder_level, drug_class, schedule, added_by)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
               RETURNING id`,
              [
                actor.pharmacyId, b.name, b.brand, b.form, b.strength, b.batchNo,
                b.expiry, b.qty, b.mrp, b.cost, b.gst, b.mfr, b.rack,
                b.reorder, b.cls, b.sch, actor.id,
              ],
            );
            const id = rows[0]!.id;
            ids.push(id);

            await recordMovement(client, {
              pharmacyId: actor.pharmacyId,
              batchId: id,
              kind: "receive",
              delta: b.qty,
              qtyAfter: b.qty,
              byUser: actor.id,
            });
          }

          const units = body.batches.reduce((n, b) => n + b.qty, 0);
          await audit(client, {
            pharmacyId: actor.pharmacyId,
            actorId: actor.id,
            actorName: actor.name,
            action: "stock.receive",
            summary: `Received ${body.batches.length} batch(es), ${units} units`,
            meta: { batches: body.batches.length, units },
            ip: request.ip,
          });

          return ids;
        });

        return reply.code(201).send({ ids: created });
      } catch (error) {
        // The UNIQUE (pharmacy_id, name, batch_no) constraint firing means the
        // same delivery was keyed twice.
        if ((error as { code?: string }).code === "23505")
          return reply
            .code(409)
            .send({ error: "That batch number already exists for this medicine." });
        throw error;
      }
    },
  );

  /* -------------------------------------------------------------- adjust */

  app.patch(
    "/stock/:id/qty",
    { preHandler: [blockIfPasswordChangePending, requires("adjustStock")] },
    async (request, reply) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
      const body = z
        .object({
          delta: z.number().int(),
          reason: z.enum(ADJUST_REASONS),
          note: z.string().default(""),
        })
        .parse(request.body);

      const actor = request.user!;

      try {
        const applied = await withTransaction(async (client) => {
          const { rows } = await client.query<{ qty: number; name: string; batch_no: string; strength: string }>(
            `SELECT qty, name, batch_no, strength FROM batches
              WHERE id = $1 AND pharmacy_id = $2 FOR UPDATE`,
            [id, actor.pharmacyId],
          );
          const batch = rows[0];
          if (!batch)
            throw Object.assign(new Error("Batch not found."), { statusCode: 404 });

          // Clamp at zero and record what actually moved, not what was asked.
          const delta = Math.max(0, batch.qty + body.delta) - batch.qty;
          if (delta === 0) return { delta: 0, qtyAfter: batch.qty };

          const { rows: updated } = await client.query<{ qty: number }>(
            "UPDATE batches SET qty = qty + $2 WHERE id = $1 RETURNING qty",
            [id, delta],
          );

          await recordMovement(client, {
            pharmacyId: actor.pharmacyId,
            batchId: id,
            kind: "adjust",
            delta,
            qtyAfter: updated[0]!.qty,
            reason: body.reason,
            note: body.note,
            byUser: actor.id,
          });

          await audit(client, {
            pharmacyId: actor.pharmacyId,
            actorId: actor.id,
            actorName: actor.name,
            action: "stock.adjust",
            summary: `${delta > 0 ? "+" : ""}${delta} ${batch.name} ${batch.strength} (batch ${batch.batch_no}) — ${body.reason}${body.note ? `: ${body.note}` : ""}`,
            meta: { batchId: id, delta, reason: body.reason },
            ip: request.ip,
          });

          return { delta, qtyAfter: updated[0]!.qty };
        });

        return reply.send(applied);
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        if (status) return reply.code(status).send({ error: (error as Error).message });
        throw error;
      }
    },
  );

  /* ---------------------------------------------------- expired write-off */

  app.post(
    "/stock/write-off-expired",
    { preHandler: [blockIfPasswordChangePending, requires("writeOffExpired")] },
    async (request, reply) => {
      const actor = request.user!;

      const summary = await withTransaction(async (client) => {
        const { rows } = await client.query<{ id: string; qty: number; value: string }>(
          `SELECT id, qty, (qty * COALESCE(NULLIF(cost, 0), mrp))::numeric(12,2) AS value
             FROM batches
            WHERE pharmacy_id = $1 AND expiry < CURRENT_DATE AND qty > 0
            FOR UPDATE`,
          [actor.pharmacyId],
        );

        let loss = 0;
        for (const row of rows) {
          loss += Number(row.value);
          await client.query("UPDATE batches SET qty = 0 WHERE id = $1", [row.id]);
          await recordMovement(client, {
            pharmacyId: actor.pharmacyId,
            batchId: row.id,
            kind: "writeoff",
            delta: -row.qty,
            qtyAfter: 0,
            reason: "Expired write-off",
            byUser: actor.id,
          });
        }

        await audit(client, {
          pharmacyId: actor.pharmacyId,
          actorId: actor.id,
          actorName: actor.name,
          action: "stock.writeoff",
          summary: `Wrote off ${rows.length} expired batch(es) — loss ₹${loss.toFixed(2)}`,
          meta: { batches: rows.length, loss },
          ip: request.ip,
        });

        return { batches: rows.length, loss };
      });

      return reply.send(summary);
    },
  );

  /* --------------------------------------------------------------- reports */

  app.get("/stock/reorder", async (request, reply) => {
    const rows = await query(
      `SELECT name, form, strength, on_hand AS "onHand",
              reorder_level AS "reorderLevel",
              (reorder_level - on_hand) AS deficit,
              nearest_expiry AS "nearestExpiry"
         FROM product_availability
        WHERE pharmacy_id = $1 AND reorder_level > 0 AND on_hand <= reorder_level
        ORDER BY (reorder_level - on_hand) DESC`,
      [request.user!.pharmacyId],
    );
    return reply.send({ reorder: rows });
  });

  app.get("/stock/expiry", async (request, reply) => {
    const rows = await query(
      `SELECT id, name, brand, form, strength, batch_no AS "batchNo",
              expiry, qty, mrp,
              (expiry - CURRENT_DATE) AS "daysLeft",
              CASE
                WHEN expiry <  CURRENT_DATE                     THEN 'expired'
                WHEN expiry <= CURRENT_DATE + INTERVAL '30 day' THEN 'critical'
                WHEN expiry <= CURRENT_DATE + INTERVAL '90 day' THEN 'warning'
                ELSE 'ok'
              END AS level
         FROM batches
        WHERE pharmacy_id = $1 AND qty > 0
          AND expiry <= CURRENT_DATE + INTERVAL '90 day'
        ORDER BY expiry ASC`,
      [request.user!.pharmacyId],
    );
    return reply.send({ batches: rows });
  });
}
