"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import { api } from "@/lib/api";

type Session = { amount: number; keyId: string | null; providerRef: string | null; restaurant: string };

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void };
  }
}

export default function RazorpayPage() {
  const params = useParams<{ id: string }>();
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    api<Session>(`/api/payments/sessions/${params.id}`).then(setSession).catch(() => toast.error("Razorpay session missing"));
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    document.body.appendChild(script);
  }, [params.id]);

  function open() {
    if (!session?.keyId || !session.providerRef || !window.Razorpay) {
      toast.error("Razorpay Checkout has not loaded");
      return;
    }
    const checkout = new window.Razorpay({
      key: session.keyId,
      amount: Math.round(session.amount * 100),
      currency: "INR",
      name: session.restaurant,
      order_id: session.providerRef,
      handler: async (response: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) => {
        await api("/api/payments/razorpay/verify", { method: "POST", body: JSON.stringify({ sessionId: params.id, ...response }) });
        toast.success("Razorpay confirmed the payment");
      },
    });
    checkout.open();
  }

  return (
    <main className="mx-auto max-w-md px-4 py-16">
      <h1 className="display text-4xl">Razorpay test checkout</h1>
      <p className="mt-2 text-sm text-[#b7b1a8]">Card fields are Razorpay&apos;s, not ours. Use their test cards with the test keys in the environment.</p>
      <button type="button" onClick={open} className="mt-6 rounded-full bg-[#ff9933] px-5 py-3 font-semibold text-[#1a1208]">Open hosted checkout</button>
    </main>
  );
}
