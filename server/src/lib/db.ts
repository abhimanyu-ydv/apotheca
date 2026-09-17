import pg from "pg";

/**
 * Connection pool and transaction helper.
 *
 * NUMERIC comes back from `pg` as a string by default to avoid float precision
 * loss. We keep that behaviour and convert deliberately at the edges — money
 * silently becoming a JS float is exactly the bug this schema avoids.
 */

const { Pool, types } = pg;

// INT8 (bigserial ids, counts) → number. Safe for our magnitudes.
types.setTypeParser(20, (value) => Number(value));

/**
 * DATE (oid 1082) → the plain `YYYY-MM-DD` string, not a JS Date.
 *
 * By default `pg` turns a DATE into a Date at local midnight, which then
 * serialises to the previous day for any timezone east of UTC. An expiry of
 * 2026-10-02 was coming back as "2026-10-01T18:30:00Z" on an IST machine —
 * a batch appearing to expire a day early is not an acceptable rounding error
 * in a pharmacy. A calendar date has no timezone; keep it as text.
 */
types.setTypeParser(1082, (value) => value);

export const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ??
    "postgres://apotheca:apotheca@localhost:5432/apotheca",
  max: Number(process.env.PG_POOL_MAX ?? 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on("error", (err) => {
  console.error("[db] idle client error", err);
});

export type Client = pg.PoolClient;

/**
 * Run `fn` inside a transaction, rolling back on any throw.
 *
 * This is the whole reason the app needs a real database rather than the
 * key-value store the prototype used: issuing a bill must decrement several
 * batches and insert the invoice as one atomic step, or two counters can sell
 * the same last box.
 */
export async function withTransaction<T>(
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Convenience for one-off reads outside a transaction. */
export async function query<R extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: readonly unknown[] = [],
): Promise<R[]> {
  const result = await pool.query<R>(text, params as unknown[]);
  return result.rows;
}

export const money = (value: string | number | null): number =>
  value === null ? 0 : Number(value);

export async function closePool(): Promise<void> {
  await pool.end();
}
