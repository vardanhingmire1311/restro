"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { toast } from "sonner";
import { apiBase } from "./api";
import { clearStaff, staffSession } from "./session";

type LiveValue = { connected: boolean; pulse: number };

const LiveContext = createContext<LiveValue>({ connected: false, pulse: 0 });

export function useLive() {
  return useContext(LiveContext);
}

export function LiveProvider({ children }: { children: React.ReactNode }) {
  const [connected, setConnected] = useState(false);
  const [pulse, setPulse] = useState(0);

  useEffect(() => {
    const session = staffSession();
    if (!session) return;
    const socket: Socket = io(process.env.NEXT_PUBLIC_SOCKET_URL || apiBase() || undefined, {
      auth: { token: session.token },
      withCredentials: true,
    });
    socket.on("connect", () => setConnected(true));
    socket.on("disconnect", () => setConnected(false));
    socket.on("session:revoked", () => {
      clearStaff();
      window.location.href = "/staff?reason=revoked";
    });
    socket.on("floor", (event: { kind?: string; tableNo?: number | null; itemName?: string; deliveryId?: string | null; kotNo?: number }) => {
      setPulse((value) => value + 1);
      if (event.kind === "item.ready" && session.user.role === "waiter") {
        toast.success(`${event.tableNo ? `Table ${event.tableNo}` : event.deliveryId}: ${event.itemName} is ready`);
      }
      if (event.kind === "kot.new" && session.user.role === "chef") {
        toast(`New ticket ${event.tableNo ? `· table ${event.tableNo}` : event.deliveryId || ""}`);
      }
    });
    return () => {
      socket.disconnect();
    };
  }, []);

  useEffect(() => {
    if (connected) return;
    const timer = setInterval(() => {
      setPulse((value) => value + 1);
    }, 4000);
    return () => clearInterval(timer);
  }, [connected]);

  return <LiveContext.Provider value={{ connected, pulse }}>{children}</LiveContext.Provider>;
}
