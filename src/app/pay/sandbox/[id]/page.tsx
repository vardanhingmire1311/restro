"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import { api, ApiError, inr } from "@/lib/api";

export default function SandboxPage() {
  const params = useParams<{ id: string }>();
  const [amount, setAmount] = useState<number | null>(null);
  const [name, setName] = useState("Test Guest");
  const [number, setNumber] = useState("4111 1111 1111 1111");
  const [expiry, setExpiry] = useState("12/30");
  const [done, setDone] = useState(false);

  useEffect(() => {
    api<{ amount: number; restaurant: string }>(`/api/payments/sessions/${params.id}`).then((session) => setAmount(session.amount)).catch(() => toast.error("Session not found"));
  }, [params.id]);

  async function pay(event: React.FormEvent) {
    event.preventDefault();
    try {
      await api("/api/payments/mock/charge", { method: "POST", body: JSON.stringify({ sessionId: params.id, number, expiry, name }) });
      setDone(true);
    } catch (reason) {
      toast.error(reason instanceof ApiError ? reason.message : "Card not accepted");
    }
  }

  return (
    <main className="mx-auto max-w-md px-4 py-12">
      <p className="text-xs uppercase tracking-[0.2em] text-[#ff9933]">Sandbox gateway</p>
      <h1 className="display mt-2 text-4xl">Card details stay on this page</h1>
      <p className="mt-2 text-sm text-[#b7b1a8]">This is not Razorpay or Stripe. The number is checked and thrown away. Only the last four digits are stored. Success: 4111111111111111. Decline: 4000000000000002.</p>
      {done ? <p className="mt-6 text-emerald-300">Paid {amount == null ? "" : inr(amount)}. You can close this window. The table frees when every share is paid.</p> : (
        <form onSubmit={pay} className="glass mt-6 space-y-3 rounded-3xl p-5">
          <p className="display text-3xl">{amount == null ? "…" : inr(amount)}</p>
          <input value={name} onChange={(event) => setName(event.target.value)} className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-3" aria-label="Name on card" />
          <input value={number} onChange={(event) => setNumber(event.target.value)} inputMode="numeric" autoComplete="off" className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-3" aria-label="Card number" />
          <input value={expiry} onChange={(event) => setExpiry(event.target.value)} className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-3" aria-label="Expiry" placeholder="MM/YY" />
          <input className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-3" aria-label="CVV" placeholder="CVV" maxLength={4} />
          <button className="w-full rounded-full bg-[#ff9933] py-3 font-semibold text-[#1a1208]" type="submit">Pay</button>
        </form>
      )}
    </main>
  );
}
