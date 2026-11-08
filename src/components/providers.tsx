"use client";

import { useEffect } from "react";
import { Toaster } from "sonner";

export function Providers({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
  }, []);
  return (
    <>
      {children}
      <Toaster theme="dark" position="top-center" toastOptions={{ style: { background: "#17171b", color: "#f4efe6", border: "1px solid rgba(255,153,51,0.35)" } }} />
    </>
  );
}
