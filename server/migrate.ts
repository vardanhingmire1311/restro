import fs from "node:fs";
import path from "node:path";
import { getPool } from "./db";

export async function migrate() {
  const pool = getPool();
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  const dir = path.join(process.cwd(), "db/migrations");
  const files = fs.readdirSync(dir).filter((file) => file.endsWith(".sql")).sort();
  for (const file of files) {
    const done = await pool.query("SELECT 1 FROM schema_migrations WHERE id = $1", [file]);
    if (done.rowCount) continue;
    const sql = fs.readFileSync(path.join(dir, file), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (id) VALUES ($1)", [file]);
      await client.query("COMMIT");
      console.log(`migrated ${file}`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

const invoked = process.argv[1] && /migrate\.ts$/.test(process.argv[1]);
if (invoked) {
  migrate().then(() => process.exit(0)).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
