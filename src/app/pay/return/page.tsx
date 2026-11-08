"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api, ApiError } from "@/lib/api";

function ReturnBody() {
  const params = useSearchParams();
  const [message, setMessage] = useState("Checking the payment…");

  useEffect(() => {
    const gateway = params.get("gateway");
    const sessionId = params.get("session_id") || params.get("session");
    const run = async () => {
      try {
        if (gateway === "stripe" && sessionId) await api("/api/payments/stripe/confirm", { method: "POST", body: JSON.stringify({ sessionId }) });
        else if (gateway === "phonepe" && sessionId) await api("/api/payments/phonepe/confirm", { method: "POST", body: JSON.stringify({ sessionId }) });
        else {
          setMessage("Nothing to confirm.");
          return;
        }
        setMessage("Payment confirmed. The bill will show it at the counter.");
      } catch (reason) {
        setMessage(reason instanceof ApiError ? reason.message : "The gateway did not confirm payment");
      }
    };
    run();
  }, [params]);

  return <main className="mx-auto max-w-lg px-4 py-16"><h1 className="display text-4xl">Back from the gateway</h1><p className="mt-3 text-[#b7b1a8]">{message}</p></main>;
}

export default function ReturnPage() {
  return <Suspense fallback={<main className="p-8">Returning…</main>}><ReturnBody /></Suspense>;
}
