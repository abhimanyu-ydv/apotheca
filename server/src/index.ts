import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { ZodError } from "zod";

import { closePool, query } from "./lib/db.ts";
import { authenticate } from "./lib/auth.ts";
import { authRoutes } from "./routes/auth.ts";
import { staffRoutes } from "./routes/staff.ts";
import { stockRoutes } from "./routes/stock.ts";
import { billRoutes } from "./routes/bills.ts";
import { prescriptionRoutes } from "./routes/prescriptions.ts";

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? "0.0.0.0";

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? "info",
    // Never let a password or a bearer token reach the log file.
    redact: ["req.headers.authorization", "req.body.password", "req.body.newPassword"],
  },
  trustProxy: true,
});

await app.register(cors, {
  origin: (process.env.CORS_ORIGIN ?? "http://localhost:5173").split(","),
  credentials: true,
});

await app.register(rateLimit, {
  max: Number(process.env.RATE_LIMIT ?? 300),
  timeWindow: "1 minute",
});

/* Sign-in is the one endpoint worth throttling hard — it's the guessing target. */
app.register(async (scoped) => {
  await scoped.register(rateLimit, { max: 10, timeWindow: "1 minute" });
  await scoped.register(authRoutes);
});

await app.register(staffRoutes);
await app.register(stockRoutes);
await app.register(billRoutes);
await app.register(prescriptionRoutes);

/* --------------------------------------------------------------- support */

app.get("/health", async () => {
  const rows = await query<{ now: Date }>("SELECT now() AS now");
  return { ok: true, db: rows[0]?.now?.toISOString() ?? null };
});

app.get("/audit", { preHandler: authenticate }, async (request, reply) => {
  if (request.user!.role !== "Chief Pharmacist" && request.user!.role !== "Pharmacist")
    return reply.code(403).send({ error: "Audit access is restricted." });

  const rows = await query(
    `SELECT id, at, actor_name AS "actorName", action, summary, meta
       FROM audit_log
      WHERE pharmacy_id = $1
      ORDER BY at DESC
      LIMIT 500`,
    [request.user!.pharmacyId],
  );
  return reply.send({ audit: rows });
});

/* ---------------------------------------------------------------- errors */

app.setErrorHandler((error, request, reply) => {
  if (error instanceof ZodError) {
    return reply.code(400).send({
      error: "That request wasn't in the expected shape.",
      details: error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    });
  }

  // Postgres constraint violations are usually a real conflict, not a bug.
  const code = (error as { code?: string }).code;
  if (code === "23505") return reply.code(409).send({ error: "That record already exists." });
  if (code === "23503") return reply.code(409).send({ error: "That record is still referenced elsewhere." });
  if (code === "23514")
    return reply.code(409).send({ error: "That change would break a stock or pricing rule." });

  request.log.error({ err: error }, "unhandled");
  return reply.code(error.statusCode ?? 500).send({
    error: error.statusCode ? error.message : "Something went wrong.",
  });
});

/* ---------------------------------------------------------------- start */

const shutdown = async (signal: string) => {
  app.log.info(`${signal} received, shutting down`);
  await app.close();
  await closePool();
  process.exit(0);
};

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

try {
  await app.listen({ port: PORT, host: HOST });
  app.log.info(`Apotheca API listening on http://${HOST}:${PORT}`);
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
