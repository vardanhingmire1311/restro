"use client";

import Image from "next/image";
import Link from "next/link";
import { UtensilsCrossed, ArrowRight, ShieldCheck } from "lucide-react";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { homeFor, saveStaff } from "@/lib/session";
import type { StaffUser } from "@/lib/types";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("waiter@restro.com");
  const [password, setPassword] = useState("waiter123");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    try {
      const result = await api<{ token: string; user: StaffUser }>("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
      saveStaff(result.token, result.user);
      router.push(homeFor(result.user.role));
    } catch (reason) {
      toast.error(reason instanceof ApiError ? reason.message : "Could not sign in");
    }
  }

  return (
    <main className="staff-login grid min-h-screen md:grid-cols-[1.1fr_0.9fr]">
      <section className="login-editorial"><Image src="/images/hero.webp" alt="Indian cuisine" fill priority sizes="55vw" /><div className="login-shade" /><Link href="/" className="brand"><span className="brand-mark"><UtensilsCrossed size={22} /></span>Restro</Link><div className="login-story"><p className="eyebrow">Behind every great evening</p><p className="display">One team.<br />Every detail.<br /><em>Exceptional.</em></p><p>The floor, the kitchen and the counter.<br />Seamlessly in sync.</p></div><span className="login-footnote">FIFTEEN TABLES · ONE SHARED STANDARD</span></section>
      <section className="login-form-section flex items-center justify-center px-6 py-10">
        <form onSubmit={submit} className="glass w-full max-w-md rounded-3xl p-6">
          <p className="eyebrow"><ShieldCheck size={15} className="inline" /> Staff access</p><h1 className="display mt-3 text-4xl">Welcome back.</h1><p className="mt-2 text-sm text-[#b7b1a8]">A great service starts with you.</p>
          {params.get("reason") === "revoked" ? <p className="mt-2 text-sm text-red-300">This session was revoked.</p> : null}
          <label className="mt-4 block text-sm">Email
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-3" required />
          </label>
          <label className="mt-3 block text-sm">Password
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-3" required />
          </label>
          <button className="mt-4 w-full rounded-full bg-[#ff9933] py-3 font-semibold text-[#1a1208]" type="submit">Start your shift <ArrowRight size={17} className="ml-2 inline" /></button>
          <details className="demo-logins mt-5 text-xs text-[#b7b1a8]"><summary>Local demo accounts</summary><p className="my-2 text-[#ff9933]">Change demo passwords before public hosting.</p><ul className="space-y-1">
            <li>admin@restro.com / admin123</li>
            <li>waiter@restro.com / waiter123</li>
            <li>chef@restro.com / chef123</li>
            <li>billing@restro.com / billing123</li>
          </ul></details><Link href="/" className="mt-6 block text-center text-xs text-[#b7b1a8]">Back to the guest menu ↗</Link>
        </form>
      </section>
    </main>
  );
}

export default function StaffPage() {
  return <Suspense fallback={<main className="p-8">Opening the staff door…</main>}><LoginForm /></Suspense>;
}
