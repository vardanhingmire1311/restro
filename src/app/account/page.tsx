"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Suspense } from "react";
import { api, ApiError } from "@/lib/api";
import { saveGuest } from "@/lib/session";

function AccountForm() {
  const params = useSearchParams();
  const router = useRouter();
  const [name, setName] = useState("");
  const [mobile, setMobile] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [devCode, setDevCode] = useState("");
  const [google, setGoogle] = useState(false);

  useEffect(() => {
    api<{ google: boolean }>("/api/public/config").then((config) => setGoogle(config.google)).catch(() => undefined);
    const token = params?.get("token");
    if (params?.get("google") === "ok" && token) {
      api<{ id: string; name: string; mobile: string | null }>("/api/customer/me", { token }).then((customer) => {
        saveGuest(token, customer);
        toast.success(`Signed in as ${customer.name}`);
        router.replace("/book");
      }).catch(() => toast.error("Google sign-in did not finish"));
    }
    if (params?.get("google") === "missing") toast.error("Google Sign-In needs a client id and secret");
    if (params?.get("google") === "failed") toast.error("Google did not return a profile");
  }, [params, router]);

  async function requestCode() {
    try {
      const result = await api<{ devCode?: string; channel: string }>("/api/customer/otp/request", { method: "POST", body: JSON.stringify({ name, mobile }) });
      setSent(true);
      setDevCode(result.devCode || "");
      toast.success(result.channel === "console" ? "Code printed in the server log" : "Code sent");
    } catch (reason) {
      toast.error(reason instanceof ApiError ? reason.message : "Could not send the code");
    }
  }

  async function verify() {
    try {
      const result = await api<{ token: string; customer: { id: string; name: string; mobile: string | null } }>("/api/customer/otp/verify", {
        method: "POST",
        body: JSON.stringify({ mobile, code }),
      });
      saveGuest(result.token, result.customer);
      toast.success("You are signed in");
      router.push(params?.get("next") || "/book");
    } catch (reason) {
      toast.error(reason instanceof ApiError ? reason.message : "Code not accepted");
    }
  }

  return (
    <main className="mx-auto grid min-h-screen max-w-5xl items-center gap-8 px-4 py-10 md:grid-cols-2">
      <div>
        <p className="text-sm uppercase tracking-[0.25em] text-[#ff9933]">Guests</p>
        <h1 className="display mt-2 text-5xl">A name and a mobile. That is the whole account.</h1>
        <p className="mt-4 text-[#b7b1a8]">The menu does not ask you to sign in. Booking a table or sending food home does.</p>
        <Link href="/" className="mt-6 inline-block text-[#ff9933]">Back to the menu</Link>
      </div>
      <form className="glass space-y-3 rounded-3xl p-6" onSubmit={(event) => { event.preventDefault(); if (sent) void verify(); else void requestCode(); }}>
        <label className="block text-sm">Name
          <input value={name} onChange={(event) => setName(event.target.value)} className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-3" required />
        </label>
        <label className="block text-sm">Mobile
          <input value={mobile} onChange={(event) => setMobile(event.target.value)} inputMode="numeric" placeholder="98XXXXXXXX" className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-3" required />
        </label>
        {sent ? (
          <label className="block text-sm">6-digit code
            <input value={code} onChange={(event) => setCode(event.target.value)} className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-3" required />
          </label>
        ) : null}
        {devCode ? <p className="rounded-xl bg-black/40 px-3 py-2 text-sm">Dev code {devCode}. Production hides this and uses Fast2SMS or Twilio.</p> : null}
        <button type="submit" className="w-full rounded-full bg-[#ff9933] py-3 font-semibold text-[#1a1208]">{sent ? "Verify and continue" : "Send code"}</button>
        {google ? <a href="/api/customer/google/start" className="block rounded-full border border-white/15 py-3 text-center">Continue with Google</a> : <p className="text-xs text-[#b7b1a8]">Google Sign-In appears here after GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set.</p>}
      </form>
    </main>
  );
}

export default function AccountPage() {
  return <Suspense fallback={<main className="p-8 text-[#b7b1a8]">Opening the door…</main>}><AccountForm /></Suspense>;
}
