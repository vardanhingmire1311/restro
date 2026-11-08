"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { StaffFrame } from "@/components/staff-frame";
import { MenuPicker } from "@/components/menu-picker";
import { api, ApiError, inr } from "@/lib/api";
import { useLive } from "@/lib/live";
import { staffSession } from "@/lib/session";
import type { Bill, CartLine, MenuPayload, TableTile } from "@/lib/types";

const PlacedBurst = dynamic(() => import("@/components/placed-burst").then((mod) => mod.PlacedBurst), { ssr: false });

function Floor() {
  const { pulse } = useLive();
  const [tables, setTables] = useState<TableTile[]>([]);
  const [menu, setMenu] = useState<MenuPayload | null>(null);
  const [tableNo, setTableNo] = useState<number | null>(null);
  const [bill, setBill] = useState<Bill | null>(null);
  const [draft, setDraft] = useState<CartLine[]>([]);
  const [chefNote, setChefNote] = useState("");
  const [pin, setPin] = useState("");
  const [voidId, setVoidId] = useState<string | null>(null);
  const [burst, setBurst] = useState(false);

  async function refresh() {
    const token = staffSession()?.token;
    if (!token) return;
    const next = await api<TableTile[]>("/api/tables", { token });
    setTables(next);
  }

  useEffect(() => {
    refresh().catch((reason: unknown) => toast.error(reason instanceof Error ? reason.message : "Could not load tables"));
    api<MenuPayload>("/api/public/menu").then(setMenu).catch(() => toast.error("Menu did not load"));
  }, [pulse]);

  async function openTable(table: TableTile) {
    setTableNo(table.tableNo);
    setDraft([]);
    const token = staffSession()?.token;
    if (table.orderId && token) setBill(await api<Bill>(`/api/orders/${table.orderId}`, { token }));
    else setBill(null);
  }

  async function send() {
    if (!tableNo) return;
    const token = staffSession()?.token;
    try {
      const result = await api<{ bill: Bill }>("/api/orders", {
        method: "POST",
        token,
        body: JSON.stringify({
          tableNo,
          chefNote,
          items: draft.map((line) => ({ menuItemId: line.menuItemId, variantId: line.variantId, optionIds: line.optionIds, qty: line.qty, note: line.note })),
        }),
      });
      setBill(result.bill);
      setDraft([]);
      setChefNote("");
      setBurst(true);
      setTimeout(() => setBurst(false), 1600);
      toast.success("Kitchen has the ticket");
      refresh();
    } catch (reason) {
      toast.error(reason instanceof ApiError ? reason.message : "Order did not send");
    }
  }

  async function askBill() {
    if (!bill) return;
    const token = staffSession()?.token;
    await api(`/api/orders/${bill.orderId}/bill-request`, { method: "POST", token, body: "{}" });
    toast.success("Billing has the table");
    refresh();
  }

  async function doVoid() {
    if (!voidId) return;
    const token = staffSession()?.token;
    try {
      const next = await api<Bill>(`/api/order-items/${voidId}/void`, { method: "POST", token, body: JSON.stringify({ pin }) });
      setBill(next);
      setVoidId(null);
      setPin("");
      toast.success("Item voided");
    } catch (reason) {
      toast.error(reason instanceof ApiError ? reason.message : "Void refused");
    }
  }

  const tone = (status: string) => status === "billing" ? "tile-billing" : status === "occupied" ? "tile-occupied" : "tile-available";

  return (
    <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
      <section>
        <p className="eyebrow">Service floor</p><h1 className="display text-3xl">The dining room.</h1><p className="mt-2 text-xs text-[#b7b1a8]">15 tables · Live service overview</p>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {tables.map((table) => (
            <button key={table.tableNo} type="button" onClick={() => openTable(table)} className={`tile glass rounded-2xl p-3 text-left ${tone(table.status)} ${tableNo === table.tableNo ? "outline outline-[#ff9933]" : ""}`}>
              <span className="table-label">TABLE</span><span className="display block text-2xl">{String(table.tableNo).padStart(2,"0")}</span>
              <span className="text-xs capitalize text-[#d9d3c9]">{table.status}</span>
              {table.total ? <span className="mt-1 block text-xs">{inr(table.total)}</span> : null}
            </button>
          ))}
        </div>
        <p className="mt-3 text-xs text-[#b7b1a8]">Green free · amber occupied · red bill asked</p>
      </section>
      <section>
        {!tableNo ? <div className="floor-welcome glass"><span className="floor-welcome-icon">✦</span><p className="eyebrow">Ready for service</p><h2 className="display">Every great meal<br />starts right here.</h2><p>Select a table to start an order. Your kitchen ticket and bill update together, instantly.</p><div className="floor-legend"><span>● Available</span><span>● Dining</span><span>● Billing</span></div></div> : (
          <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
            {menu ? <MenuPicker menu={menu} onAdd={(line) => setDraft((current) => [...current, line])} /> : <p>Loading the card…</p>}
            <aside className="glass h-fit rounded-3xl p-4">
              <h2 className="display text-2xl">Table {tableNo}</h2>
              {bill?.items.filter((item) => item.status !== "VOID").map((item) => (
                <div key={item.id} className="mt-2 text-sm">
                  <div className="flex justify-between gap-2"><span>{item.qty} × {item.name}</span><button type="button" className="text-red-300" onClick={() => setVoidId(item.id)}>Void</button></div>
                  {item.note ? <p className="note-hot mt-1">{item.note}</p> : null}
                </div>
              ))}
              {draft.map((line) => <p key={line.key} className="mt-2 text-sm text-[#ff9933]">{line.qty} × {line.name}</p>)}
              <label className="mt-3 block text-sm">Order note to the chef
                <input value={chefNote} onChange={(event) => setChefNote(event.target.value)} className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2" />
              </label>
              <button type="button" disabled={!draft.length} onClick={send} className="mt-3 w-full rounded-full bg-[#ff9933] py-3 font-semibold text-[#1a1208] disabled:opacity-40">Send KOT</button>
              {bill ? <button type="button" onClick={askBill} className="mt-2 w-full rounded-full border border-white/15 py-3">Request bill · {inr(bill.total)}</button> : null}
              <p className="mt-2 text-xs text-[#b7b1a8]">Waiters cannot take payment. A void needs the admin PIN.</p>
            </aside>
          </div>
        )}
      </section>
      {voidId ? (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/70 p-4">
          <form className="glass w-full max-w-sm rounded-3xl p-5" onSubmit={(event) => { event.preventDefault(); doVoid(); }}>
            <h3 className="display text-2xl">Admin PIN</h3>
            <input value={pin} onChange={(event) => setPin(event.target.value)} inputMode="numeric" className="mt-3 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-3" autoFocus />
            <div className="mt-3 flex justify-end gap-2">
              <button type="button" onClick={() => setVoidId(null)}>Cancel</button>
              <button className="rounded-full bg-[#ff9933] px-4 py-2 font-semibold text-[#1a1208]" type="submit">Void dish</button>
            </div>
          </form>
        </div>
      ) : null}
      {burst ? (
        <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center">
          <PlacedBurst />
        </div>
      ) : null}
    </div>
  );
}

export default function WaiterPage() {
  return <StaffFrame allow={["waiter", "admin"]}><Floor /></StaffFrame>;
}
