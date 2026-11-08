import { Client } from "pg";

export function pgConfig(connectionString) {
  const url = new URL(connectionString);
  const sslmode = url.searchParams.get("sslmode");
  if (sslmode) url.searchParams.delete("sslmode");
  return {
    connectionString: url.toString(),
    ssl: sslmode && sslmode !== "disable" ? { rejectUnauthorized: process.env.PGSSL_REJECT_UNAUTHORIZED === "true" } : undefined,
  };
}

export async function ensureDatabase() {
  const url = process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/restro_db";
  const direct = new Client(pgConfig(url));
  try {
    await direct.connect();
    await direct.end();
    return url;
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : "";
    if (code !== "3D000") {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`\nCould not open PostgreSQL (${message}).`);
      console.error("Install PostgreSQL and create a user postgres with password postgres,");
      console.error("or start the database with: docker compose up db");
      console.error("Windows: the PostgreSQL installer can use the same user and password, then run npm run dev again.\n");
      process.exit(1);
    }
  }
  const admin = new URL(url);
  const dbName = decodeURIComponent(admin.pathname.replace(/^\//, ""));
  if (!/^[A-Za-z0-9_]+$/.test(dbName)) {
    console.error("Database name must be letters, numbers, or underscore.");
    process.exit(1);
  }
  admin.pathname = "/postgres";
  const client = new Client(pgConfig(admin.toString()));
  try {
    await client.connect();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\nCould not reach PostgreSQL (${message}).`);
    console.error("Start Postgres locally, or run: docker compose up db\n");
    process.exit(1);
  }
  await client.query(`CREATE DATABASE "${dbName}"`);
  await client.end();
  return url;
}
