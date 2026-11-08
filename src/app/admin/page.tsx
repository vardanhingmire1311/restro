"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { StaffFrame } from "@/components/staff-frame";
import { api, ApiError, inr } from "@/lib/api";
import { useLive } from "@/lib/live";
import { staffSession } from "@/lib/session";
import type { MenuPayload } from "@/lib/types";

type Staff = { id: string; name: string; email: string; role: string; is_suspended: boolean; password_is_demo: boolean };
type SessionRow = { jti: string; email: string; role: string; device: string; ip: string; revoked_at: string | null; created_at: string };
type Audit = { id: number; actor_email: string | null; action: string; ip: string | null; device: string | null; created_at: string };
type Analytics = { sales: number; payments: { method: string; amount: number; count: number }[]; topItems: { name: string; qty: number; amount: number }[]; unsettled: { amount: number; bills: number }; voids: number };
type Settings = { restaurantName: string; address: string; phone: string; gstin: string; fssai: string; upiVpa: string; upiPayee: string; maxDiscountPercent: number; parcelChargePaise: number; hours: string; pinIsDemo: boolean; gstRateBps: number };
type Booking = { id: string; guest_name: string; mobile: string; party_size: number; booking_date: string; booking_time: string; status: string };

function Desk() {
  const { pulse } = useLive();
  const [tab, setTab] = useState<"today" | "people" | "security" | "menu" | "bookings" | "settings">("today");
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [audit, setAudit] = useState<Audit[]>([]);
  const [menu, setMenu] = useState<MenuPayload | null>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [pin, setPin] = useState({ current: "2580", next: "" });
  const token = () => staffSession()?.token;

  async function load() {
    const t = token();
    const [numbers, people, openSessions, log, card, books, config] = await Promise.all([
      api<Analytics>("/api/admin/analytics", { token: t }),
      api<Staff[]>("/api/admin/staff", { token: t }),
      api<SessionRow[]>("/api/admin/sessions", { token: t }),
      api<Audit[]>("/api/admin/audit", { token: t }),
      api<MenuPayload>("/api/admin/menu", { token: t }),
      api<Booking[]>("/api/admin/bookings", { token: t }),
      api<Settings>("/api/admin/settings", { token: t }),
    ]);
    setAnalytics(numbers);
    setStaff(people);
    setSessions(openSessions);
    setAudit(log);
    setMenu(card);
    setBookings(books);
    setSettings(config);
  }

  useEffect(() => {
    load().catch((reason: unknown) => toast.error(reason instanceof Error ? reason.message : "Desk did not load"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pulse]);

  async function saveSettings() {
    if (!settings) return;
    try {
      await api("/api/admin/settings", {
        method: "PUT",
        token: token(),
        body: JSON.stringify({
          restaurantName: settings.restaurantName,
          address: settings.address,
          phone: settings.phone,
          gstin: settings.gstin,
          fssai: settings.fssai,
          upiVpa: settings.upiVpa,
          upiPayee: settings.upiPayee,
          maxDiscountPercent: Number(settings.maxDiscountPercent),
          parcelCharge: settings.parcelChargePaise / 100,
          hours: settings.hours,
          gstRatePercent: settings.gstRateBps / 100,
        }),
      });
      toast.success("Settings saved");
    } catch (reason) {
      toast.error(reason instanceof ApiError ? reason.message : "Could not save");
    }
  }

  return (
    <div>
      <div className="operations-heading"><div><p className="eyebrow">Restaurant overview</p><h1 className="display text-4xl">The command centre.</h1><p className="operations-subtitle">Every detail, thoughtfully in view.</p></div><span className="operations-pill">15 tables · One connected restaurant</span></div>
      <div className="mt-3 flex flex-wrap gap-2">
        {(["today", "people", "security", "menu", "bookings", "settings"] as const).map((value) => (
          <button key={value} type="button" className="chip capitalize" data-on={tab === value} onClick={() => setTab(value)}>{value}</button>
        ))}
      </div>
      {tab === "today" && analytics ? (
        <section className="mt-4 grid gap-3 md:grid-cols-4">
          <article className="glass rounded-3xl p-4"><p className="text-sm text-[#b7b1a8]">Settled today</p><p className="display text-3xl">{inr(analytics.sales)}</p></article>
          <article className="glass rounded-3xl p-4"><p className="text-sm text-[#b7b1a8]">Still open</p><p className="display text-3xl">{inr(analytics.unsettled.amount)}</p><p className="text-xs">{analytics.unsettled.bills} bills</p></article>
          <article className="glass rounded-3xl p-4 md:col-span-2"><p className="text-sm text-[#b7b1a8]">By tender</p>{analytics.payments.map((row) => <p key={row.method}>{row.method} · {inr(row.amount)} · {row.count}</p>)}{!analytics.payments.length ? <p>No payments yet today.</p> : null}</article>
          <article className="glass rounded-3xl p-4 md:col-span-3"><p className="text-sm text-[#b7b1a8]">Fired today</p>{analytics.topItems.map((row) => <p key={row.name} className="flex justify-between text-sm"><span>{row.qty} × {row.name}</span><span>{inr(row.amount)}</span></p>)}</article>
          <article className="glass rounded-3xl p-4"><p className="text-sm text-[#b7b1a8]">Voids</p><p className="display text-3xl">{analytics.voids}</p></article>
        </section>
      ) : null}
      {tab === "people" ? (
        <div className="mt-4 overflow-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-[#b7b1a8]"><tr><th>Name</th><th>Email</th><th>Role</th><th></th></tr></thead>
            <tbody>
              {staff.map((person) => (
                <tr key={person.id} className="border-t border-white/10">
                  <td className="py-2">{person.name}{person.password_is_demo ? " · demo" : ""}</td>
                  <td>{person.email}</td>
                  <td>{person.role}</td>
                  <td>{person.is_suspended
                    ? <button type="button" onClick={() => api(`/api/admin/staff/${person.id}/activate`, { method: "POST", token: token(), body: "{}" }).then(load)}>Activate</button>
                    : <button type="button" className="text-red-300" onClick={() => api(`/api/admin/staff/${person.id}/suspend`, { method: "POST", token: token(), body: "{}" }).then(load).catch((reason: unknown) => toast.error(reason instanceof Error ? reason.message : "Could not suspend"))}>Suspend</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {tab === "security" ? (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <section>
            <h2 className="text-[#ff9933]">Sessions</h2>
            {sessions.map((session) => (
              <div key={session.jti} className="mt-2 flex items-center justify-between gap-2 border-t border-white/10 py-2 text-sm">
                <span>{session.email}<br /><span className="text-[#b7b1a8]">{session.device} · {session.ip}{session.revoked_at ? " · revoked" : ""}</span></span>
                {!session.revoked_at ? <button type="button" className="text-red-300" onClick={() => api(`/api/admin/sessions/${session.jti}/revoke`, { method: "POST", token: token(), body: "{}" }).then(load)}>Revoke</button> : null}
              </div>
            ))}
          </section>
          <section>
            <h2 className="text-[#ff9933]">Audit</h2>
            {audit.slice(0, 30).map((row) => <p key={row.id} className="border-t border-white/10 py-1 text-xs">{row.action} · {row.actor_email || "unknown"} · {row.ip} · {row.device}</p>)}
          </section>
        </div>
      ) : null}
      {tab === "menu" && menu ? (
        <div className="mt-4 max-h-[70vh] space-y-4 overflow-auto">
          {menu.categories.map((category) => (
            <section key={category.id}>
              <h2 className="text-sm uppercase tracking-[0.15em] text-[#ff9933]">{category.section} · {category.name}</h2>
              {category.items.map((item) => (
                <div key={item.id} className="grid grid-cols-[1fr_auto_auto] items-center gap-2 border-t border-white/10 py-1 text-sm">
                  <span>{item.veg ? "●" : "○"} {item.name}</span>
                  {item.variants.length ? <span className="text-[#b7b1a8]">{item.variants.map((variant) => variant.name).join(" / ")}</span> : (
                    <input defaultValue={item.price} className="w-24 rounded-lg border border-white/10 bg-black/30 px-2 py-1" onBlur={(event) => api(`/api/admin/menu/items/${item.id}`, { method: "PATCH", token: token(), body: JSON.stringify({ price: Number(event.target.value) }) }).catch(() => toast.error("Price not saved"))} />
                  )}
                  <button type="button" onClick={() => api(`/api/admin/menu/items/${item.id}`, { method: "PATCH", token: token(), body: JSON.stringify({ available: !item.available }) }).then(load)}>{item.available ? "86" : "Restore"}</button>
                  {item.variants.map((variant) => (
                    <label key={variant.id} className="col-span-3 text-xs text-[#b7b1a8]">{variant.name}
                      <input defaultValue={variant.price} className="ml-2 w-24 rounded-lg border border-white/10 bg-black/30 px-2 py-1" onBlur={(event) => api(`/api/admin/variants/${variant.id}`, { method: "PATCH", token: token(), body: JSON.stringify({ price: Number(event.target.value) }) }).then(() => toast.success("Price saved")).catch(() => toast.error("Price not saved"))} />
                    </label>
                  ))}
                </div>
              ))}
            </section>
          ))}
        </div>
      ) : null}
      {tab === "bookings" ? (
        <div className="mt-4 space-y-2 text-sm">
          {bookings.length === 0 ? <p className="text-[#b7b1a8]">No bookings yet.</p> : null}
          {bookings.map((booking) => (
            <div key={booking.id} className="glass flex flex-wrap items-center justify-between gap-2 rounded-2xl px-3 py-2">
              <span>{booking.guest_name} · {booking.party_size} · {String(booking.booking_date).slice(0, 10)} {String(booking.booking_time).slice(0, 5)} · {booking.mobile}</span>
              <select value={booking.status} onChange={(event) => api(`/api/admin/bookings/${booking.id}`, { method: "PATCH", token: token(), body: JSON.stringify({ status: event.target.value }) }).then(load)}>
                {["requested", "confirmed", "seated", "cancelled"].map((status) => <option key={status}>{status}</option>)}
              </select>
            </div>
          ))}
        </div>
      ) : null}
      {tab === "settings" && settings ? (
        <form className="glass mt-4 grid gap-3 rounded-3xl p-4 md:grid-cols-2" onSubmit={(event) => { event.preventDefault(); saveSettings(); }}>
          {([
            ["restaurantName", "Restaurant name"],
            ["address", "Address"],
            ["phone", "Phone"],
            ["gstin", "GSTIN"],
            ["fssai", "FSSAI"],
            ["upiVpa", "UPI VPA"],
            ["upiPayee", "UPI payee name"],
            ["hours", "Hours"],
          ] as const).map(([key, label]) => (
            <label key={key} className="text-sm">{label}
              <input value={String(settings[key] ?? "")} onChange={(event) => setSettings({ ...settings, [key]: event.target.value })} className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2" />
            </label>
          ))}
          <label className="text-sm">Max discount %
            <input type="number" value={settings.maxDiscountPercent} onChange={(event) => setSettings({ ...settings, maxDiscountPercent: Number(event.target.value) })} className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2" />
          </label>
          <label className="text-sm">Parcel charge ₹
            <input type="number" value={settings.parcelChargePaise / 100} onChange={(event) => setSettings({ ...settings, parcelChargePaise: Math.round(Number(event.target.value) * 100) })} className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2" />
          </label>
          <p className="md:col-span-2 text-xs text-[#b7b1a8]">UPI VPA restro@upi is a placeholder. It will not receive money until you put the restaurant&apos;s real VPA here. GSTIN and FSSAI print on the parcel sticker only after you set them. {settings.pinIsDemo ? "Admin PIN is still the demo 2580." : "Admin PIN has been changed."}</p>
          <button className="rounded-full bg-[#ff9933] py-2 font-semibold text-[#1a1208]" type="submit">Save</button>
          <div className="flex gap-2">
            <input value={pin.current} onChange={(event) => setPin({ ...pin, current: event.target.value })} placeholder="Current PIN" className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2" />
            <input value={pin.next} onChange={(event) => setPin({ ...pin, next: event.target.value })} placeholder="New PIN" className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2" />
            <button type="button" className="rounded-full border border-white/15 px-3" onClick={() => api("/api/admin/pin", { method: "POST", token: token(), body: JSON.stringify(pin) }).then(() => toast.success("PIN changed")).catch((reason: unknown) => toast.error(reason instanceof Error ? reason.message : "PIN"))}>PIN</button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

export default function AdminPage() {
  return <StaffFrame allow={["admin"]}><Desk /></StaffFrame>;
}
