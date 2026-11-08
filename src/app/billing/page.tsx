"use client";

import Link from "next/link";
import { ReceiptText } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { StaffFrame } from "@/components/staff-frame";
import { api, ApiError, inr } from "@/lib/api";
import { useLive } from "@/lib/live";
import { staffSession } from "@/lib/session";
import type { Bill, TableTile } from "@/lib/types";

type Gateways = { mock: boolean; upi: boolean; razorpay: boolean; stripe: boolean; phonepe: boolean };

function Desk() {
  const { pulse } = useLive();
  const [tables, setTables] = useState<TableTile[]>([]);
  const [orders, setOrders] = useState<Bill[]>([]);
  const [current, setCurrent] = useState<Bill | null>(null);
  const [discount, setDiscount] = useState("10");
  const [reason, setReason] = useState("regular guest");
  const [tendered, setTendered] = useState("");
  const [qr, setQr] = useState<{ qr: string; amount: number; vpa: string; shareId: string } | null>(null);
  const [floatAmount, setFloatAmount] = useState("2000");
  const [counted, setCounted] = useState("");
  const [drawer, setDrawer] = useState<{ open: { expected: number } | null } | null>(null);
  const [gateways, setGateways] = useState<Gateways | null>(null);
  const [deliveryId, setDeliveryId] = useState("SWG-8821");
  const [tab, setTab] = useState<"room" | "SWIGGY" | "ZOMATO">("room");

  const token = () => staffSession()?.token;

  async function load() {
    const [nextTables, nextOrders, nextDrawer, config] = await Promise.all([
      api<TableTile[]>("/api/tables", { token: token() }),
      api<Bill[]>("/api/billing/orders", { token: token() }),
      api<{ open: { expected: number } | null }>("/api/billing/drawer", { token: token() }),
      api<{ payments: Gateways }>("/api/public/config"),
    ]);
    setTables(nextTables);
    setOrders(nextOrders);
    setDrawer(nextDrawer);
    setGateways(config.payments);
    if (current) {
      const fresh = nextOrders.find((order) => order.orderId === current.orderId);
      if (fresh) setCurrent(fresh);
    }
  }

  useEffect(() => {
    load().catch((reason: unknown) => toast.error(reason instanceof Error ? reason.message : "Billing did not load"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pulse]);

  const shown = orders.filter((order) => tab === "room" ? order.type === "DINE_IN" || order.type === "DELIVERY" : order.type === tab);

  async function applyDiscount() {
    if (!current) return;
    try {
      const next = await api<Bill>(`/api/billing/orders/${current.orderId}/discount`, {
        method: "POST",
        token: token(),
        body: JSON.stringify({ mode: "percent", value: Number(discount), reason }),
      });
      setCurrent(next);
    } catch (reason) {
      toast.error(reason instanceof ApiError ? reason.message : "Discount refused");
    }
  }

  async function split() {
    if (!current) return;
    const half = Math.round((current.total / 2) * 100) / 100;
    const rest = Math.round((current.total - half) * 100) / 100;
    try {
      const next = await api<Bill>(`/api/billing/orders/${current.orderId}/split`, {
        method: "POST",
        token: token(),
        body: JSON.stringify({ parts: [{ label: "Card 1", amount: half }, { label: "Card 2", amount: rest }] }),
      });
      setCurrent(next);
    } catch (reason) {
      toast.error(reason instanceof ApiError ? reason.message : "Could not split");
    }
  }

  async function cash(shareId: string) {
    try {
      const next = await api<Bill>(`/api/billing/shares/${shareId}/cash`, { method: "POST", token: token(), body: JSON.stringify({ tendered: Number(tendered) }) });
      setCurrent(next);
      toast.success("Cash taken");
      load();
    } catch (reason) {
      toast.error(reason instanceof ApiError ? reason.message : "Cash failed");
    }
  }

  async function showQr(shareId: string) {
    const data = await api<{ qr: string; amount: number; vpa: string }>(`/api/billing/shares/${shareId}/upi`, { token: token() });
    setQr({ ...data, shareId });
  }

  async function upiReceived() {
    if (!qr) return;
    const next = await api<Bill>(`/api/billing/shares/${qr.shareId}/upi`, { method: "POST", token: token(), body: "{}" });
    setCurrent(next);
    setQr(null);
    toast.success("UPI marked received");
  }

  async function card(shareId: string, gateway: string) {
    const data = await api<{ redirectUrl: string }>(`/api/billing/shares/${shareId}/card`, { method: "POST", token: token(), body: JSON.stringify({ gateway }) });
    window.location.href = data.redirectUrl;
  }

  async function simulate(partner: "SWIGGY" | "ZOMATO") {
    const result = await api<{ order: Bill }>("/api/billing/simulate", { method: "POST", token: token(), body: JSON.stringify({ partner, deliveryId: partner === "SWIGGY" ? "SWG-8821" : "ZOM-4490" }) });
    setCurrent(result.order);
    toast.success(result.order.deliveryId || "Parcel in");
    load();
  }

  async function pickup() {
    try {
      const next = await api<Bill>("/api/pickup", { method: "POST", token: token(), body: JSON.stringify({ deliveryId }) });
      setCurrent(next);
      toast.success("Rider collected it");
    } catch (reason) {
      toast.error(reason instanceof ApiError ? reason.message : "Not ready for pickup");
    }
  }

  return (
    <div className="billing-desk"><div className="operations-heading"><div><p className="eyebrow">Billing &amp; dispatch</p><h1 className="display text-4xl">The counter.</h1><p className="operations-subtitle">From the final course to the final detail.</p></div><span className="operations-pill">Dine-in · Parcel · Delivery</span></div>
      <div className="flex flex-wrap items-end gap-2">
        {(["room", "SWIGGY", "ZOMATO"] as const).map((value) => <button key={value} type="button" className="chip" data-on={tab === value} onClick={() => setTab(value)}>{value === "room" ? "Room & delivery" : value}</button>)}
      </div>
      <div className="glass mt-3 flex flex-wrap items-center gap-2 rounded-2xl p-3 text-sm">
        <span className="text-[#ff9933]">{drawer?.open ? `Drawer expects ${inr(drawer.open.expected)}` : "Drawer closed"}</span>
        <input value={floatAmount} onChange={(event) => setFloatAmount(event.target.value)} className="w-28 rounded-xl border border-white/10 bg-black/30 px-3 py-2" aria-label="Opening float" />
        <button type="button" className="rounded-full border border-white/15 px-3 py-2" onClick={() => api("/api/billing/drawer/open", { method: "POST", token: token(), body: JSON.stringify({ float: Number(floatAmount) }) }).then(load).catch((reason: unknown) => toast.error(reason instanceof Error ? reason.message : "Drawer"))}>Open</button>
        <input value={counted} onChange={(event) => setCounted(event.target.value)} className="w-32 rounded-xl border border-white/10 bg-black/30 px-3 py-2" aria-label="Counted cash" placeholder="Counted" />
        <button type="button" className="rounded-full border border-white/15 px-3 py-2" onClick={() => api("/api/billing/drawer/close", { method: "POST", token: token(), body: JSON.stringify({ counted: Number(counted) }) }).then(load).catch((reason: unknown) => toast.error(reason instanceof Error ? reason.message : "Drawer"))}>Close and reconcile</button>
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-[280px_1fr]">
        <div className="space-y-2">
          {tab === "room" ? <div className="billing-table-grid">{tables.map((table) => (
            <button key={table.tableNo} type="button" onClick={() => { const order = orders.find((entry) => entry.orderId === table.orderId); if (order) setCurrent(order); }} className={`tile glass block w-full rounded-2xl p-3 text-left ${table.status === "billing" ? "tile-billing" : table.status === "occupied" ? "tile-occupied" : "tile-available"}`}>
              <span className="display text-2xl">{table.tableNo}</span>
              <span className="ml-2 text-sm">{table.total ? inr(table.total) : table.status}</span>
            </button>
          ))}</div> : null}
          {shown.map((order) => (
            <button key={order.orderId} type="button" onClick={() => setCurrent(order)} className="glass block w-full rounded-2xl p-3 text-left">
              <span className="font-semibold">{order.tableNo ? `Table ${order.tableNo}` : order.deliveryId}</span>
              <span className="mt-1 block text-sm text-[#ff9933]">{inr(order.total)} · {order.paymentStatus}</span>
            </button>
          ))}
          {tab !== "room" ? (
            <div className="glass space-y-2 rounded-2xl p-3">
              <button type="button" className="w-full rounded-full bg-[#ff9933] py-2 font-semibold text-[#1a1208]" onClick={() => simulate(tab)}>Simulate {tab} webhook</button>
              <input value={deliveryId} onChange={(event) => setDeliveryId(event.target.value)} className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2" />
              <button type="button" className="w-full rounded-full border border-white/15 py-2" onClick={pickup}>Mark picked up</button>
            </div>
          ) : null}
        </div>
        <article className="glass rounded-3xl p-5">
          {!current ? <div className="billing-welcome"><ReceiptText size={40} strokeWidth={1} /><p className="eyebrow">The final detail</p><h2 className="display">Every detail,<br />accounted for.</h2><p>Choose an occupied table or a parcel to see the itemised bill, split payments or prepare a dispatch label.</p><span>Cash · UPI · Card</span></div> : (
            <>
              <div className="flex flex-wrap items-end justify-between gap-2">
                <div>
                  <h2 className="display text-4xl">{current.tableNo ? `Table ${current.tableNo}` : current.deliveryId}</h2>
                  <p className="text-sm text-[#b7b1a8]">Bill {current.billNo} · {current.type} · {current.paymentStatus}</p>
                </div>
                {(current.type === "SWIGGY" || current.type === "ZOMATO" || current.type === "DELIVERY") ? <Link className="rounded-full border border-white/15 px-3 py-2 text-sm" href={`/print/sticker/${current.orderId}`}>Sticker</Link> : <Link className="rounded-full border border-white/15 px-3 py-2 text-sm" href={`/print/bill/${current.orderId}`}>Print</Link>}
              </div>
              {current.items.filter((item) => item.status !== "VOID").map((item) => (
                <div key={item.id} className="mt-2 flex justify-between text-sm"><span>{item.qty} × {item.name}</span><span>{inr(item.amount)}</span></div>
              ))}
              <div className="mt-4 space-y-1 text-sm text-[#d9d3c9]">
                <p>Food {inr(current.subtotal)}</p>
                <p>Discount {inr(current.discount)}</p>
                <p>CGST {inr(current.cgst)} · SGST {inr(current.sgst)}</p>
                <p>Parcel {inr(current.parcel)}</p>
                <p className="display text-3xl text-[#ff9933]">{inr(current.total)}</p>
              </div>
              {current.paymentStatus === "UNSETTLED" || current.paymentStatus === "PARTIAL" ? (
                <div className="mt-4 space-y-3">
                  <div className="flex flex-wrap gap-2">
                    <input value={discount} onChange={(event) => setDiscount(event.target.value)} className="w-20 rounded-xl border border-white/10 bg-black/30 px-3 py-2" />
                    <input value={reason} onChange={(event) => setReason(event.target.value)} className="min-w-40 flex-1 rounded-xl border border-white/10 bg-black/30 px-3 py-2" />
                    <button type="button" className="rounded-full border border-white/15 px-3" onClick={applyDiscount}>% off</button>
                    <button type="button" className="rounded-full border border-white/15 px-3" onClick={split}>Split in two</button>
                  </div>
                  {current.shares.filter((share) => share.status === "UNPAID").map((share) => (
                    <div key={share.id} className="rounded-2xl border border-white/10 p-3">
                      <p className="font-semibold">{share.label} · {inr(share.amount)}</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <input value={tendered} onChange={(event) => setTendered(event.target.value)} placeholder="Cash tendered" className="w-32 rounded-xl border border-white/10 bg-black/30 px-3 py-2" />
                        <button type="button" className="pay rounded-full bg-white/10 px-3 py-2" onClick={() => cash(share.id)}>Cash</button>
                        <button type="button" className="pay rounded-full bg-white/10 px-3 py-2" onClick={() => showQr(share.id)}>UPI QR</button>
                        <button type="button" className="pay rounded-full bg-[#ff9933] px-3 py-2 font-semibold text-[#1a1208]" onClick={() => card(share.id, "mock")}>Sandbox card</button>
                        {gateways?.razorpay ? <button type="button" className="rounded-full border border-white/15 px-3 py-2" onClick={() => card(share.id, "razorpay")}>Razorpay test</button> : null}
                        {gateways?.stripe ? <button type="button" className="rounded-full border border-white/15 px-3 py-2" onClick={() => card(share.id, "stripe")}>Stripe test</button> : null}
                        {gateways?.phonepe ? <button type="button" className="rounded-full border border-white/15 px-3 py-2" onClick={() => card(share.id, "phonepe")}>PhonePe</button> : null}
                      </div>
                    </div>
                  ))}
                </div>
              ) : <p className="mt-4 text-emerald-300">Settled on {current.paymentStatus === "PREPAID" ? "the aggregator" : "the counter"}.</p>}
            </>
          )}
        </article>
      </div>
      {qr ? (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/70 p-4">
          <div className="glass max-w-sm rounded-3xl p-5 text-center">
            <p className="text-sm text-[#b7b1a8]">Guest pays {inr(qr.amount)} to {qr.vpa}. This QR does not confirm the bank credit by itself.</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qr.qr} alt="UPI QR" className="mx-auto mt-3 w-56 rounded-xl bg-white p-2" />
            <div className="mt-3 flex justify-center gap-2">
              <button type="button" onClick={() => setQr(null)}>Close</button>
              <button type="button" className="rounded-full bg-[#ff9933] px-4 py-2 font-semibold text-[#1a1208]" onClick={upiReceived}>Payment received</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function BillingPage() {
  return <StaffFrame allow={["billing", "admin"]}><Desk /></StaffFrame>;
}
