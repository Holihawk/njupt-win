import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { getPool } from "../src/db.js";

const pool = getPool();
await pool.query(`
  CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )
`);

const directory = path.join(process.cwd(), "db/migrations");
const migrations = (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort();

for (const name of migrations) {
  const applied = await pool.query("SELECT 1 FROM schema_migrations WHERE name = $1", [name]);
  if (applied.rowCount) continue;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(await readFile(path.join(directory, name), "utf8"));
    await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [name]);
    await client.query("COMMIT");
    console.log(`[applied] ${name}`);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

await pool.end();
