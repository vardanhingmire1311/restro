import pg from 'pg';
import { spawnSync } from 'node:child_process';
const client = new pg.Client({connectionString:'postgresql://postgres:postgres@127.0.0.1:5432/postgres'});
await client.connect();
const result = await client.query("SELECT 1 FROM pg_database WHERE datname = 'restro_design_test'");
if (!result.rowCount) await client.query('CREATE DATABASE restro_design_test');
await client.end();
const test = spawnSync(process.execPath,['node_modules/vitest/vitest.mjs','run'],{stdio:'inherit',env:{...process.env,TEST_DATABASE_URL:'postgresql://postgres:postgres@127.0.0.1:5432/restro_design_test'}});
process.exitCode = test.status ?? 1;
