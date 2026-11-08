"use client";

import Link from "next/link";
import { UtensilsCrossed, LayoutDashboard, CookingPot, ReceiptText, Grid2X2, LogOut } from "lucide-react";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { LiveProvider, useLive } from "@/lib/live";
import { clearStaff, homeFor, staffSession } from "@/lib/session";
import type { Role, StaffUser } from "@/lib/types";

function Bar({ user }: { user: StaffUser }) {
  const { connected } = useLive();
  const pathname = usePathname();
  const links = user.role === "admin"
    ? [["/admin", "Desk"], ["/waiter", "Floor"], ["/kitchen", "Kitchen"], ["/billing", "Bills"]]
    : [[homeFor(user.role), user.role === "chef" ? "Kitchen" : user.role === "billing" ? "Bills" : "Floor"]];
  return (
    <header className="staff-bar no-print sticky top-0 z-20 flex flex-wrap items-center gap-3 border-b border-white/10 bg-[#0f0f11]/80 px-4 py-3 backdrop-blur-xl">
      <Link href={homeFor(user.role)} className="staff-brand display text-2xl text-[#ff9933]"><UtensilsCrossed size={23} />Restro</Link>
      <nav className="flex gap-2 text-sm">
        {links.map(([href, label]) => (
          <Link key={href} href={href} className={`rounded-full px-3 py-1 ${pathname === href ? "bg-[#ff9933] text-[#1a1208]" : "text-[#d9d3c9]"}`}>{href === "/admin" ? <LayoutDashboard size={15} /> : href === "/kitchen" ? <CookingPot size={15} /> : href === "/billing" ? <ReceiptText size={15} /> : <Grid2X2 size={15} />}{label}</Link>
        ))}
      </nav>
      <div className="ml-auto flex items-center gap-3 text-sm text-[#b7b1a8]">
        <span className={`h-2 w-2 rounded-full ${connected ? "bg-emerald-400" : "bg-red-500"}`} aria-hidden />
        <span>{connected ? "Live" : "Reconnecting"}</span>
        <span className="hidden sm:inline">{user.name} · {user.role}</span>
        <button type="button" className="rounded-full border border-white/15 px-3 py-1" onClick={() => { clearStaff(); window.location.href = "/staff"; }}><LogOut size={14} className="mr-1 inline" />Sign out</button>
      </div>
      {user.passwordIsDemo ? <p className="w-full text-xs text-[#ff9933]">Demo password. Change it before this desk is on the public internet.</p> : null}
    </header>
  );
}

export function StaffFrame({ allow, children }: { allow: Role[]; children: React.ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<StaffUser | null>(null);

  const allowKey = allow.join(",");
  useEffect(() => {
    const session = staffSession();
    if (!session) {
      router.replace("/staff");
      return;
    }
    if (!allowKey.split(",").includes(session.user.role) && session.user.role !== "admin") {
      router.replace(homeFor(session.user.role));
      return;
    }
    setUser(session.user);
  }, [allowKey, router]);

  if (!user) return <main className="p-8 text-[#b7b1a8]">Checking the pass…</main>;
  return (
    <LiveProvider>
      <Bar user={user} />
      <main className="operations-main mx-auto max-w-7xl px-4 py-5">{children}</main>
    </LiveProvider>
  );
}
