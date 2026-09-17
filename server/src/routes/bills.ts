import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { query, withTransaction } from "../lib/db.ts";
import {
  authenticate,
  blockIfPasswordChangePending,
  requires,
} from "../lib/auth.ts";
import { audit, recordMovement } from "../lib/audit.ts";
import { nextBillNumber } from "../lib/ids.ts";
import { computeTotals } from "../lib/money.ts";

interface BatchRow {
  id: string;
  name: string;
  brand: string;
  form: string;
  strength: string;
  batch_no: string;
  expiry: string;
  qty: number;
  mrp: string;
  gst: number;
}

export async function billRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);

  /* ----------------------------------------------------------------- list */

  app.get("/bills", async (request, reply) => {
    const q = z
      .object({
        search: z.string().optional(),
        limit: z.coerce.number().min(1).max(500).default(100),
      })
      .parse(request.query);

    const rows = await query(
      `SELECT b.*,
              COALESCE(json_agg(
                json_build_object(
                  'batchId', l.batch_id, 'name', l.name, 'brand', l.brand,
                  'form', l.form, 'strength', l.strength, 'batchNo', l.batch_no,
                  'expiry', l.expiry, 'qty', l.qty, 'mrp', l.mrp, 'gst', l.gst
                ) ORDER BY l.line_no
              ) FILTER (WHERE l.id IS NOT NULL), '[]') AS lines
         FROM bills b
         LEFT JOIN bill_lines l ON l.bill_id = b.id
        WHERE b.pharmacy_id = $1
          AND ($2::text IS NULL
               OR b.bill_no ILIKE '%' || $2 || '%'
               OR b.patient_name ILIKE '%' || $2 || '%')
        GROUP BY b.id
        ORDER BY b.issued_at DESC
        LIMIT $3`,
      [request.user!.pharmacyId, q.search ?? null, q.limit],
    );

    return reply.send({ bills: rows });
  });

  /* ---------------------------------------------------------------- issue */

  /**
   * Issue a bill.
   *
   * The entire operation is one transaction:
   *   1. lock every batch involved (`FOR UPDATE`, ordered by id to avoid
   *      deadlocks between two tills)
   *   2. re-check quantity and expiry against the *locked* rows, not the ones
   *      the browser saw a moment ago
   *   3. recompute the totals server-side — the client's figures are ignored
   *   4. insert the bill, decrement the stock, record the movements
   *   5. close out the prescription, if this bill came from one
   *
   * If anything fails, none of it happened. That guarantee is the reason to
   * move off a key-value store.
   */
  app.post(
    "/bills",
    { preHandler: [blockIfPasswordChangePending, requires("fulfilPrescription")] },
    async (request, reply) => {
      const body = z
        .object({
          patientName: z.string().min(1),
          patientRef: z.string().nullish(),
          doctor: z.string().default(""),
          prescriptionId: z.string().nullish(),
          paymentMode: z.string().min(1),
          paymentRef: z.string().default(""),
          discountPct: z.number().min(0).max(100).default(0),
          lines: z
            .array(
              z.object({
                batchId: z.string().uuid(),
                qty: z.number().int().positive(),
              }),
            )
            .min(1),
        })
        .parse(request.body);

      const actor = request.user!;

      // Collapse duplicate batch ids so a caller can't split one batch across
      // two lines to dodge the quantity check.
      const wanted = new Map<string, number>();
      for (const line of body.lines) {
        wanted.set(line.batchId, (wanted.get(line.batchId) ?? 0) + line.qty);
      }
      const batchIds = [...wanted.keys()].sort();

      try {
        const result = await withTransaction(async (client) => {
          const { rows: batches } = await client.query<BatchRow>(
            `SELECT id, name, brand, form, strength, batch_no, expiry, qty, mrp, gst
               FROM batches
              WHERE id = ANY($1::uuid[]) AND pharmacy_id = $2
              ORDER BY id
              FOR UPDATE`,
            [batchIds, actor.pharmacyId],
          );

          if (batches.length !== batchIds.length) {
            throw Object.assign(new Error("One of those batches no longer exists."), {
              statusCode: 409,
            });
          }

          const today = new Date().toISOString().slice(0, 10);

          for (const batch of batches) {
            const qty = wanted.get(batch.id)!;
            if (batch.expiry < today) {
              throw Object.assign(
                new Error(
                  `Batch ${batch.batch_no} of ${batch.name} expired on ${batch.expiry} and cannot be dispensed.`,
                ),
                { statusCode: 422 },
              );
            }
            if (batch.qty < qty) {
              throw Object.assign(
                new Error(
                  `Only ${batch.qty} left in batch ${batch.batch_no} of ${batch.name}; ${qty} requested.`,
                ),
                { statusCode: 409 },
              );
            }
          }

          // Totals are recomputed here from the locked rows. Whatever the
          // client sent is not consulted.
          const priced = batches.map((b) => ({
            batch: b,
            qty: wanted.get(b.id)!,
          }));
          const totals = computeTotals(
            priced.map((p) => ({ mrp: p.batch.mrp, qty: p.qty, gst: p.batch.gst })),
            body.discountPct,
          );

          const { rows: pharmacyRows } = await client.query<{ name: string }>(
            "SELECT name FROM pharmacies WHERE id = $1",
            [actor.pharmacyId],
          );
          const billNo = await nextBillNumber(
            client,
            actor.pharmacyId,
            pharmacyRows[0]?.name ?? "RX",
          );

          const { rows: billRows } = await client.query<{ id: string; issued_at: Date }>(
            `INSERT INTO bills
               (pharmacy_id, bill_no, patient_name, patient_ref, doctor,
                prescription_id, payment_mode, payment_ref,
                taxable, gst_total, discount_pct, discount_amt, net, issued_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
             RETURNING id, issued_at`,
            [
              actor.pharmacyId,
              billNo,
              body.patientName,
              body.patientRef ?? null,
              body.doctor,
              body.prescriptionId ?? null,
              body.paymentMode,
              body.paymentRef,
              totals.taxable,
              totals.gstTotal,
              totals.discountPct,
              totals.discountAmt,
              totals.net,
              actor.id,
            ],
          );
          const bill = billRows[0]!;

          let lineNo = 0;
          for (const { batch, qty } of priced) {
            lineNo += 1;
            await client.query(
              `INSERT INTO bill_lines
                 (bill_id, line_no, batch_id, name, brand, form, strength,
                  batch_no, expiry, qty, mrp, gst)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
              [
                bill.id,
                lineNo,
                batch.id,
                batch.name,
                batch.brand,
                batch.form,
                batch.strength,
                batch.batch_no,
                batch.expiry,
                qty,
                batch.mrp,
                batch.gst,
              ],
            );

            // The CHECK (qty >= 0) is the last line of defence if this ever
            // races past the FOR UPDATE.
            const { rows: updated } = await client.query<{ qty: number }>(
              "UPDATE batches SET qty = qty - $2 WHERE id = $1 RETURNING qty",
              [batch.id, qty],
            );

            await recordMovement(client, {
              pharmacyId: actor.pharmacyId,
              batchId: batch.id,
              kind: "dispense",
              delta: -qty,
              qtyAfter: updated[0]?.qty ?? null,
              billId: bill.id,
              byUser: actor.id,
            });
          }

          if (body.prescriptionId) {
            const { rowCount } = await client.query(
              `UPDATE prescriptions
                  SET status = 'dispensed', dispensed_at = now(),
                      dispensed_by = $2, bill_id = $3
                WHERE id = $1 AND pharmacy_id = $4 AND status = 'open'`,
              [body.prescriptionId, actor.id, bill.id, actor.pharmacyId],
            );
            if (rowCount) {
              await audit(client, {
                pharmacyId: actor.pharmacyId,
                actorId: actor.id,
                actorName: actor.name,
                action: "rx.dispense",
                summary: `${body.prescriptionId} dispensed against bill ${billNo}`,
                meta: { rx: body.prescriptionId, billNo },
              });
            }
          }

          await audit(client, {
            pharmacyId: actor.pharmacyId,
            actorId: actor.id,
            actorName: actor.name,
            action: "bill.issue",
            summary: `Bill ${billNo} — ${body.patientName}, ${priced.length} item(s), ₹${totals.net.toFixed(2)}`,
            meta: { billNo, net: totals.net },
            ip: request.ip,
          });

          return { id: bill.id, billNo, issuedAt: bill.issued_at, totals };
        });

        return reply.code(201).send(result);
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        if (status) return reply.code(status).send({ error: (error as Error).message });
        throw error;
      }
    },
  );

  /* --------------------------------------------------------------- return */

  app.post(
    "/bills/:id/return",
    { preHandler: [blockIfPasswordChangePending, requires("returnBill")] },
    async (request, reply) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
      const body = z.object({ reason: z.string().min(1) }).parse(request.body);
      const actor = request.user!;

      try {
        await withTransaction(async (client) => {
          const { rows } = await client.query<{ bill_no: string; status: string; net: string }>(
            `SELECT bill_no, status, net FROM bills
              WHERE id = $1 AND pharmacy_id = $2 FOR UPDATE`,
            [id, actor.pharmacyId],
          );
          const bill = rows[0];
          if (!bill)
            throw Object.assign(new Error("Bill not found."), { statusCode: 404 });
          if (bill.status === "returned")
            throw Object.assign(new Error("That bill was already returned."), {
              statusCode: 409,
            });

          const { rows: lines } = await client.query<{ batch_id: string; qty: number }>(
            "SELECT batch_id, qty FROM bill_lines WHERE bill_id = $1 ORDER BY batch_id",
            [id],
          );

          for (const line of lines) {
            const { rows: updated } = await client.query<{ qty: number }>(
              "UPDATE batches SET qty = qty + $2 WHERE id = $1 RETURNING qty",
              [line.batch_id, line.qty],
            );
            await recordMovement(client, {
              pharmacyId: actor.pharmacyId,
              batchId: line.batch_id,
              kind: "return",
              delta: line.qty,
              qtyAfter: updated[0]?.qty ?? null,
              billId: id,
              reason: "Customer return",
              note: body.reason,
              byUser: actor.id,
            });
          }

          await client.query(
            `UPDATE bills
                SET status = 'returned', returned_at = now(),
                    returned_by = $2, return_reason = $3
              WHERE id = $1`,
            [id, actor.id, body.reason],
          );

          await audit(client, {
            pharmacyId: actor.pharmacyId,
            actorId: actor.id,
            actorName: actor.name,
            action: "bill.return",
            summary: `Returned bill ${bill.bill_no} (₹${Number(bill.net).toFixed(2)}) — ${body.reason}`,
            meta: { billNo: bill.bill_no },
            ip: request.ip,
          });
        });

        return reply.code(204).send();
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        if (status) return reply.code(status).send({ error: (error as Error).message });
        throw error;
      }
    },
  );
}
