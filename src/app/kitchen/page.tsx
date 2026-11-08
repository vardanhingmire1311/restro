"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { StaffFrame } from "@/components/staff-frame";
import { api } from "@/lib/api";
import { useLive } from "@/lib/live";
import { staffSession } from "@/lib/session";
import type { Ticket } from "@/lib/types";

function column(ticket: Ticket) {
  if (ticket.items.some((item) => item.status === "QUEUED")) return "New";
  if (ticket.items.some((item) => item.status === "PREPARING")) return "Cooking";
  return "Ready";
}

function ageColor(createdAt: string) {
  const ratio = Math.min(1, (Date.now() - new Date(createdAt).getTime()) / (15 * 60 * 1000));
  const red = Math.round(255 * ratio + 244 * (1 - ratio));
  const green = Math.round(80 * ratio + 239 * (1 - ratio));
  const blue = Math.round(80 * ratio + 230 * (1 - ratio));
  return `rgb(${red}, ${green}, ${blue})`;
}

function clock(createdAt: string) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function Board() {
  const { pulse } = useLive();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [partner, setPartner] = useState("");
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  async function fetchTickets() {
    const token = staffSession()?.token;
    if (!token) return;
    try {
      const next = await api<Ticket[]>(`/api/kds${partner ? `?partner=${partner}` : ""}`, { token });
      setTickets(next);
    } catch (reason: unknown) {
      // quiet retry
    }
  }

  useEffect(() => {
    fetchTickets();
  }, [pulse, partner]);

  async function move(id: string, status: "PREPARING" | "READY") {
    // Optimistic UI update so button and column change instantly
    setTickets((prev) =>
      prev.map((ticket) => ({
        ...ticket,
        items: ticket.items.map((item) => (item.id === id ? { ...item, status } : item)),
      }))
    );
    const token = staffSession()?.token;
    try {
      await api(`/api/order-items/${id}/status`, { method: "PATCH", token, body: JSON.stringify({ status }) });
      await fetchTickets();
    } catch (reason) {
      await fetchTickets();
      toast.error(reason instanceof Error ? reason.message : "Could not update the ticket");
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-4"><p className="eyebrow">Kitchen live</p><h1 className="display text-4xl">The pass.</h1></div>
        {["", "SWIGGY", "ZOMATO"].map((value) => (
          <button key={value || "all"} type="button" className="chip" data-on={partner === value} onClick={() => setPartner(value)}>{value || "All"}</button>
        ))}
        <span className="text-xs text-[#b7b1a8]">Timers turn red at 15 minutes. Prices stay at billing.</span>
      </div>
      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        {["New", "Cooking", "Ready"].map((name) => (
          <section key={name} className="kds-column min-h-64" data-column={name}>
            <h2 className="mb-2 text-sm uppercase tracking-[0.2em] text-[#ff9933]">{name}<span className="kds-count">{tickets.filter((ticket) => column(ticket) === name).length}</span></h2>
            <div className="space-y-3">{!tickets.some((ticket) => column(ticket) === name) ? <div className="kds-empty"><span>✓</span><p>{name === "New" ? "All caught up" : name === "Cooking" ? "Nothing on the flame" : "Waiting for the next plate"}</p><small>Tickets appear here in real time</small></div> : null}
              {tickets.filter((ticket) => column(ticket) === name).map((ticket) => (
                <article key={ticket.id} className="glass rounded-3xl p-4" style={{ borderColor: ageColor(ticket.createdAt) }}>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="display text-2xl">{ticket.tableNo ? `Table ${ticket.tableNo}` : ticket.deliveryId}</p>
                      <p className="text-xs text-[#b7b1a8]">KOT {ticket.kotNo} · {ticket.type}</p>
                    </div>
                    <div className="text-right">
                      {ticket.parcel ? <span className="rounded-full bg-[#ff9933] px-2 py-1 text-xs font-bold text-[#1a1208]">PARCEL</span> : null}
                      <p className="timer mt-1" style={{ color: ageColor(ticket.createdAt) }}>{clock(ticket.createdAt)}{now ? "" : ""}</p>
                    </div>
                  </div>
                  {ticket.chefNote ? <p className="note-hot mt-3">CHEF NOTE · {ticket.chefNote}</p> : null}
                  <ul className="mt-3 space-y-2">
                    {ticket.items.map((item) => (
                      <li key={item.id}>
                        <div className="flex items-center justify-between gap-2">
                          <span>{item.qty} × {item.name}</span>
                          <span className="text-xs uppercase text-[#b7b1a8]">{item.station}</span>
                        </div>
                        {item.note ? <p className="note-hot mt-1">{item.note}</p> : null}
                        <div className="mt-1 flex gap-2">
                          {item.status === "QUEUED" ? <button type="button" className="rounded-full bg-white/10 px-3 py-1 text-sm" onClick={() => move(item.id, "PREPARING")}>Cook</button> : null}
                          {item.status === "PREPARING" ? <button type="button" className="rounded-full bg-[#ff9933] px-3 py-1 text-sm font-semibold text-[#1a1208]" onClick={() => move(item.id, "READY")}>Ready</button> : null}
                          {item.status === "READY" ? <span className="text-sm text-emerald-300">Ready</span> : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

export default function KitchenPage() {
  return <StaffFrame allow={["chef", "admin"]}><Board /></StaffFrame>;
}
