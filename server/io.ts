import type { Server } from "socket.io";

let io: Server | null = null;

export function setIo(server: Server) {
  io = server;
}

export function emitFloor(payload: Record<string, unknown>) {
  io?.emit("floor", payload);
}

export function kickUser(userId: string) {
  io?.to(`user:${userId}`).emit("session:revoked", { userId });
  io?.in(`user:${userId}`).disconnectSockets(true);
}
