import { spawn } from "node:child_process";
import { ensureDatabase } from "./db.mjs";

const databaseUrl = await ensureDatabase();
const child = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], {
  stdio: "inherit",
  env: {
    ...process.env,
    DATABASE_URL: process.env.DATABASE_URL || databaseUrl,
    PORT: process.env.PORT || "3847",
    TZ: process.env.TZ || "Asia/Kolkata",
    NODE_ENV: "production",
    OTP_DEV_REVEAL: process.env.OTP_DEV_REVEAL || "false",
  },
});
child.on("exit", (code) => process.exit(code ?? 0));
