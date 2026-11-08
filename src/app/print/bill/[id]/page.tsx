"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api, inr } from "@/lib/api";
import { staffSession } from "@/lib/session";
import type { Bill } from "@/lib/types";

export default function PrintBillPage() {
  const params = useParams<{ id: string }>();
  const [bill, setBill] = useState<Bill | null>(null);

  useEffect(() => {
    const token = staffSession()?.token;
    api<Bill>(`/api/orders/${params.id}`, { token }).then((next) => {
      setBill(next);
      setTimeout(() => window.print(), 300);
    }).catch(() => undefined);
  }, [params.id]);

  if (!bill) return <main className="p-6">Preparing the bill…</main>;
  return (
    <main className="print-sheet mx-auto max-w-sm bg-white p-4 text-black">
      <p className="receipt-caption">THE ART OF GOOD FOOD</p><h1 className="display text-center text-3xl">Restro</h1>
      <p className="text-center text-sm">Bill {bill.billNo} · {bill.tableNo ? `Table ${bill.tableNo}` : bill.deliveryId}</p>
      {bill.items.filter((item) => item.status !== "VOID").map((item) => (
        <p key={item.id} className="mt-1 flex justify-between text-sm"><span>{item.qty} × {item.name}</span><span>{inr(item.amount)}</span></p>
      ))}
      <hr className="my-2" />
      <p className="flex justify-between text-sm"><span>CGST</span><span>{inr(bill.cgst)}</span></p>
      <p className="flex justify-between text-sm"><span>SGST</span><span>{inr(bill.sgst)}</span></p>
      <p className="flex justify-between text-sm"><span>Discount</span><span>{inr(bill.discount)}</span></p>
      <p className="mt-2 flex justify-between text-lg font-bold"><span>Total</span><span>{inr(bill.total)}</span></p>
      <p className="receipt-thanks">Thank you for dining with us.<br />Good food. Great company.</p>
      <button type="button" className="no-print mt-4 rounded-full bg-black px-4 py-2 text-white" onClick={() => window.print()}>Print</button>
    </main>
  );
}
