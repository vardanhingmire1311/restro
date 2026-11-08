import { Pool, type PoolClient, type QueryResultRow } from "pg";

export type Sql = Pool | PoolClient;

function connectionConfig(connectionString: string) {
  const url = new URL(connectionString);
  const sslmode = url.searchParams.get("sslmode");
  if (sslmode) url.searchParams.delete("sslmode");
  const tz = process.env.TZ || "Asia/Kolkata";
  if (!/^[\w/+-]+$/.test(tz)) throw new Error("Invalid TZ");
  return {
    connectionString: url.toString(),
    ssl: sslmode && sslmode !== "disable" ? { rejectUnauthorized: process.env.PGSSL_REJECT_UNAUTHORIZED === "true" } : undefined,
    options: `-c timezone=${tz}`,
    max: 10,
  };
}

let pool: Pool | null = null;

export function getPool() {
  if (!pool) {
    const url = process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/restro_db";
    pool = new Pool(connectionConfig(url));
    pool.on("error", (error) => {
      console.error("postgres pool error", error);
    });
  }
  return pool;
}

export async function withTx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      console.error("rollback failed", rollbackError);
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function one<T extends QueryResultRow>(sql: Sql, text: string, params: unknown[] = []) {
  const result = await sql.query<T>(text, params);
  return result.rows[0] ?? null;
}

export async function many<T extends QueryResultRow>(sql: Sql, text: string, params: unknown[] = []) {
  const result = await sql.query<T>(text, params);
  return result.rows;
}

export function isUniqueViolation(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && (error as { code: string }).code === "23505";
}
