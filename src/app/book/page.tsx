"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { guestSession } from "@/lib/session";

export default function BookPage() {
  const [ready, setReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("19:30");
  const [partySize, setPartySize] = useState(2);
  const [notes, setNotes] = useState("");
  const [mobile, setMobile] = useState("");
  const slots = Array.from({ length: 23 }, (_, index) => {
    const minutes = 12 * 60 + index * 30;
    return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  });

  useEffect(() => {
    const guest = guestSession();
    setSignedIn(Boolean(guest));
    setMobile(guest?.customer.mobile || "");
    setDate(new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }));
    setReady(true);
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const guest = guestSession();
    if (!guest) return;
    try {
      await api("/api/customer/bookings", {
        method: "POST",
        token: guest.token,
        body: JSON.stringify({ date, time, partySize, notes, mobile: mobile || undefined }),
      });
      toast.success("Request sent. The desk will confirm the sitting.");
    } catch (reason) {
      toast.error(reason instanceof ApiError ? reason.message : "Could not book");
    }
  }

  if (!ready) return <main className="p-8">Loading…</main>;
  if (!signedIn) {
    return <main className="mx-auto max-w-lg px-4 py-16"><h1 className="display text-4xl">Sign in to hold a table</h1><Link href="/account?next=/book" className="mt-6 inline-block rounded-full bg-[#ff9933] px-4 py-2 font-semibold text-[#1a1208]">Continue</Link></main>;
  }

  return (
    <main className="mx-auto max-w-xl px-4 py-10">
      <Link href="/" className="text-sm text-[#ff9933]">Menu</Link>
      <h1 className="display mt-3 text-5xl">Hold a table</h1>
      <p className="mt-2 text-[#b7b1a8]">Half-hour sittings from noon until 11. Fifteen bookings can share a slot, one for each table.</p>
      <form onSubmit={submit} className="glass mt-6 space-y-3 rounded-3xl p-5">
        <label className="block text-sm">Date<input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-3" required /></label>
        <label className="block text-sm">Time
          <select value={time} onChange={(event) => setTime(event.target.value)} className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-3">
            {slots.map((slot) => <option key={slot}>{slot}</option>)}
          </select>
        </label>
        <label className="block text-sm">Party<input type="number" min={1} max={12} value={partySize} onChange={(event) => setPartySize(Number(event.target.value))} className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-3" /></label>
        <label className="block text-sm">Mobile<input value={mobile} onChange={(event) => setMobile(event.target.value)} className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-3" placeholder="Needed if Google did not provide one" /></label>
        <label className="block text-sm">Note<textarea value={notes} onChange={(event) => setNotes(event.target.value)} className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-3" rows={3} /></label>
        <button className="w-full rounded-full bg-[#ff9933] py-3 font-semibold text-[#1a1208]" type="submit">Request the table</button>
      </form>
    </main>
  );
}
