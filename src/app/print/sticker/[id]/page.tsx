"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api, inr } from "@/lib/api";
import { staffSession } from "@/lib/session";

type Sticker = {
  restaurant: string;
  fssai: string;
  gstin: string;
  partner: string;
  deliveryId: string | null;
  prepaid: boolean;
  chefNote: string | null;
  items: { id: string; name: string; qty: number; note: string | null; amount: number }[];
  subtotal: number;
  cgst: number;
  sgst: number;
  parcel: number;
  total: number;
  barcode: string;
  qr: string;
};

export default function StickerPage() {
  const params = useParams<{ id: string }>();
  const [sticker, setSticker] = useState<Sticker | null>(null);

  useEffect(() => {
    const token = staffSession()?.token;
    api<Sticker>(`/api/billing/orders/${params.id}/sticker`, { token }).then((next) => {
      setSticker(next);
      setTimeout(() => window.print(), 400);
    }).catch(() => undefined);
  }, [params.id]);

  if (!sticker) return <main className="p-6">Preparing the sticker…</main>;
  return (
    <main className="print-sheet mx-auto w-[80mm] bg-white p-2 text-black">
      <p className="text-center text-sm font-bold">{sticker.restaurant || "Restro"}</p>
      <p className="text-center text-[10px]">FSSAI {sticker.fssai || "not set"} · GSTIN {sticker.gstin || "not set"}</p>
      <p className="mt-2 text-center text-xs">{sticker.partner}</p>
      <p className="text-center text-2xl font-black">{sticker.deliveryId}</p>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={sticker.barcode} alt="Delivery barcode" className="mx-auto mt-1 w-full" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={sticker.qr} alt="Delivery QR" className="mx-auto mt-1 h-24 w-24" />
      {sticker.items.map((item) => (
        <p key={item.id} className="mt-1 text-xs">{item.qty} × {item.name}{item.note ? ` (${item.note})` : ""} · {inr(item.amount)}</p>
      ))}
      {sticker.chefNote ? <p className="mt-1 text-xs font-bold">NOTE {sticker.chefNote}</p> : null}
      <p className="mt-1 text-xs">Parcel {inr(sticker.parcel)} · GST {inr(sticker.cgst + sticker.sgst)}</p>
      <p className="text-sm font-black">TOTAL {inr(sticker.total)} · {sticker.prepaid ? "PRE-PAID" : "TO COLLECT"}</p>
      <button type="button" className="no-print mt-3 rounded bg-black px-3 py-1 text-xs text-white" onClick={() => window.print()}>Print label</button>
    </main>
  );
}
