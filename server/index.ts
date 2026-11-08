import "dotenv/config";
import http from "node:http";
import next from "next";
import { Server } from "socket.io";
import { createApp } from "./app";
import { actorFromToken } from "./auth";
import { migrate } from "./migrate";
import { seed } from "./seed";
import { setIo } from "./io";

const port = Number(process.env.PORT || 3847);
const dev = process.env.NODE_ENV !== "production";

async function main() {
  if (!process.env.TZ) process.env.TZ = "Asia/Kolkata";
  await migrate();
  await seed();
  const expressApp = createApp();
  const nextApp = next({ dev, dir: process.cwd() });
  const handle = nextApp.getRequestHandler();
  await nextApp.prepare();
  const server = http.createServer(expressApp);
  const io = new Server(server, { cors: { origin: true, credentials: true } });
  setIo(io);
  io.use(async (socket, nextFn) => {
    try {
      const token = typeof socket.handshake.auth?.token === "string" ? socket.handshake.auth.token : null;
      const actor = await actorFromToken(token);
      if (!actor) {
        nextFn(new Error("Sign in required"));
        return;
      }
      socket.data.actor = actor;
      nextFn();
    } catch (error) {
      nextFn(error instanceof Error ? error : new Error("Sign in required"));
    }
  });
  io.on("connection", (socket) => {
    const actor = socket.data.actor as { id: string; role: string };
    socket.join(`user:${actor.id}`);
    socket.join(`role:${actor.role}`);
  });
  expressApp.use((req, res) => {
    handle(req, res).catch((error: unknown) => {
      console.error(error);
      if (!res.headersSent) res.status(500).end("Something went wrong");
    });
  });
  server.listen(port, "0.0.0.0", () => {
    console.log(`Restro listening on http://127.0.0.1:${port}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

process.on("unhandledRejection", (error) => {
  console.error("unhandledRejection", error);
});
process.on("uncaughtException", (error) => {
  console.error("uncaughtException", error);
});
