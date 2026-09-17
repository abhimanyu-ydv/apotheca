import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { closePool, pool } from "./lib/db.ts";

/**
 * Minimal forward-only migration runner.
 *
 * Each file in `migrations/` runs once, inside its own transaction, and is
 * recorded in `schema_migrations`. No down-migrations: rolling a schema
 * backwards on a live pharmacy is a restore-from-backup job, not a script.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(HERE, "..", "migrations");

async function main(): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename   TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const { rows } = await client.query<{ filename: string }>(
      "SELECT filename FROM schema_migrations",
    );
    const applied = new Set(rows.map((r) => r.filename));

    const files = (await readdir(MIGRATIONS_DIR))
      .filter((f) => f.endsWith(".sql"))
      .sort();

    let ran = 0;
    for (const file of files) {
      if (applied.has(file)) continue;

      const sql = await readFile(join(MIGRATIONS_DIR, file), "utf8");
      process.stdout.write(`  applying ${file} … `);

      try {
        // The migration files carry their own BEGIN/COMMIT, so don't nest one.
        await client.query(sql);
        await client.query(
          "INSERT INTO schema_migrations (filename) VALUES ($1)",
          [file],
        );
        process.stdout.write("ok\n");
        ran += 1;
      } catch (error) {
        process.stdout.write("failed\n");
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      }
    }

    console.log(
      ran === 0
        ? "Schema already up to date."
        : `Applied ${ran} migration${ran === 1 ? "" : "s"}.`,
    );
  } finally {
    client.release();
    await closePool();
  }
}

main().catch((error) => {
  console.error("Migration failed:", error);
  process.exit(1);
});
