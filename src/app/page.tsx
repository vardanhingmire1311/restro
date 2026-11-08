"use client";

import Link from "next/link";
import Image from "next/image";
import { ArrowUpRight, ArrowRight, ShoppingBag, UtensilsCrossed, Clock3, MapPin, Phone, X, Minus, Plus, Sparkles } from "lucide-react";
import { foodImage } from "@/lib/food-images";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { MenuPicker } from "@/components/menu-picker";
import { api, ApiError, inr } from "@/lib/api";
import { guestSession } from "@/lib/session";
import type { CartLine, MenuPayload } from "@/lib/types";

export default function HomePage() {
  const router = useRouter();
  const [menu, setMenu] = useState<MenuPayload | null>(null);
  const [error, setError] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [open, setOpen] = useState(false);
  const [address, setAddress] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    api<MenuPayload>("/api/public/menu").then(setMenu).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Menu unavailable"));
    const saved = localStorage.getItem("restro_cart");
    if (saved) { try { setCart(JSON.parse(saved) as CartLine[]); } catch { localStorage.removeItem("restro_cart"); } }
  }, []);

  useEffect(() => {
    localStorage.setItem("restro_cart", JSON.stringify(cart));
  }, [cart]);

  function add(line: CartLine) {
    setCart((current) => {
      const existing = current.find((item) => item.key === line.key);
      if (!existing) return [...current, line];
      return current.map((item) => item.key === line.key ? { ...item, qty: item.qty + line.qty } : item);
    });
    toast.success(`${line.name} added`);
  }

  const total = cart.reduce((sum, line) => sum + line.price * line.qty, 0);

  async function checkout() {
    const guest = guestSession();
    if (!guest) {
      router.push("/account?next=/");
      return;
    }
    try {
      await api("/api/customer/delivery", {
        method: "POST",
        token: guest.token,
        body: JSON.stringify({
          address,
          chefNote: note,
          items: cart.map((line) => ({ menuItemId: line.menuItemId, variantId: line.variantId, optionIds: line.optionIds, qty: line.qty, note: line.note })),
        }),
      });
      setCart([]);
      setOpen(false);
      toast.success("Delivery is with the kitchen. Pay when it arrives.");
    } catch (reason) {
      toast.error(reason instanceof ApiError ? reason.message : "Could not place the delivery");
    }
  }

  const allDishes = menu?.categories.flatMap((category) => category.items) ?? [];
  const featured = ["paneer", "biryani", "pizza", "sandwich", "brownie", "mojito"].flatMap((word) => {
    const found = allDishes.find((item) => item.available && item.name.toLowerCase().includes(word));
    return found ? [found] : [];
  });
  const count = cart.reduce((sum, line) => sum + line.qty, 0);
  function changeQty(key: string, delta: number) { setCart((current) => current.map((line) => line.key === key ? { ...line, qty: line.qty + delta } : line).filter((line) => line.qty > 0)); }
  return (
    <div className="customer-site">
      <header className="guest-nav"><Link href="/" className="brand"><span className="brand-mark"><UtensilsCrossed size={22} /></span><span>{menu?.restaurant.name || "Restro"}<small>THE ART OF GOOD FOOD</small></span></Link><nav><a href="#menu" className="nav-menu">Explore menu</a><Link href="/staff" className="staff-link">Staff portal</Link><Link href="/book" className="primary-button">Book a table <ArrowUpRight size={16} /></Link></nav></header>
      <section className="hero">
        <Image src="/images/hero.webp" alt="Indian curry served with warm naan and fresh herbs" fill priority sizes="100vw" className="hero-image" />
        <div className="hero-shade" /><div className="hero-content"><p className="eyebrow"><span /> A seat at our table</p><h1 className="display">Good food.<br />Great company.<br /><em>Unforgettable.</em></h1><p>From the warmth of Indian spices to flavours from around the world. Made with care. Shared with love.</p><div className="hero-actions"><a href="#menu" className="primary-button">Discover the menu <ArrowRight size={18} /></a><Link href="/book" className="outline-button">Reserve your evening <ArrowUpRight size={17} /></Link></div><div className="hero-details"><span><UtensilsCrossed size={15} /> 15 tables. Endless stories.</span><span><Sparkles size={15} /> Freshly prepared, always.</span></div></div><div className="hero-caption"><span>THE INDIAN TABLE</span><small>Tradition, with a little imagination.</small></div>
      </section>
      <div className="experience-strip"><span>INDIAN SOUL</span><span className="strip-star">✦</span><span>GLOBAL FLAVOURS</span><span className="strip-star">✦</span><span>MADE TO ORDER</span><span className="strip-star">✦</span><span>SHARED WITH LOVE</span></div>
      <main className="guest-main">
        {featured.length ? <section className="featured-section"><div className="section-heading"><div><p className="eyebrow">Something to tempt you</p><h2 className="display">A taste of what awaits.</h2></div><a href="#menu" className="text-link">The full menu <ArrowUpRight size={18} /></a></div><div className="featured-rail">{featured.map((item, index) => <a href="#menu" key={item.id} className="featured-card"><div className="featured-photo"><Image src={foodImage(item.name, item.uiGroup)} alt={item.name + " — representative photo"} fill loading="lazy" sizes="(max-width:640px) 75vw, 300px" /><span className="featured-number">0{index+1}</span><span className="featured-arrow"><ArrowUpRight size={20} /></span></div><div className="featured-label"><h3>{item.name}</h3><span>{inr(item.price)}</span></div></a>)}</div><p className="photo-disclaimer">A selection from our live menu · representative cuisine photography</p></section> : null}
        <section id="menu" className="full-menu"><div className="section-heading"><div><p className="eyebrow">Find your flavour</p><h2 className="display">The menu.</h2></div><p className="section-aside">A little indulgence.<br />A lot of choice.</p></div>{error ? <div className="empty-state glass">{error}<button type="button" className="chip mt-3" onClick={() => window.location.reload()}>Try again</button></div> : null}{!menu && !error ? <div className="menu-loading">Preparing something delicious...</div> : null}{menu ? <MenuPicker menu={menu} onAdd={add} /> : null}</section>
        <section className="reservation-banner glass"><div><p className="eyebrow">Make an evening of it</p><h2 className="display">Your table is waiting.</h2><p>Come for the food. Stay for the conversation.</p></div><Link href="/book" className="primary-button">Reserve a table <ArrowUpRight size={18} /></Link></section>
      </main>
      <footer className="guest-footer"><div className="footer-brand"><span className="display">{menu?.restaurant.name || "Restro"}</span><p>Indian soul. A world of flavour.<br />Good moments begin around a table.</p></div><div><h3><Clock3 size={15} /> Opening hours</h3><p>{menu?.restaurant.hours || "Ask our team for today's hours."}</p></div><div><h3><MapPin size={15} /> Find us</h3><p>{menu?.restaurant.address || "Location available at the restaurant."}</p>{menu?.restaurant.phone ? <p><Phone size={13} className="inline" /> {menu.restaurant.phone}</p> : null}</div><div className="footer-bottom"><span>© {new Date().getFullYear()} {menu?.restaurant.name || "Restro"} · Crafted for good company.</span><Link href="/staff">Staff access <ArrowUpRight size={13} className="inline" /></Link></div></footer>
      <button type="button" className="cart-dock" onClick={() => setOpen(true)}><span className="cart-icon"><ShoppingBag size={19} /><b>{count}</b></span><span>Your delivery bag<small>{count ? "Something delicious is waiting" : "Build your perfect meal"}</small></span><strong>{inr(total)}</strong><ArrowRight size={19} /></button>
      {open ? <div className="fixed inset-0 z-50 flex items-end justify-end bg-black/75 backdrop-blur-sm sm:items-stretch" role="dialog" aria-modal="true" aria-label="Delivery cart"><div className="cart-panel glass max-h-[94dvh] w-full overflow-auto rounded-t-3xl p-6 sm:max-h-screen sm:max-w-lg sm:rounded-none"><div className="flex items-center justify-between"><p className="eyebrow">A feast, delivered</p><button type="button" className="chip" aria-label="Close cart" onClick={() => setOpen(false)}><X size={18} /></button></div><h2 className="display mt-3 text-4xl">Your bag.</h2>{!cart.length ? <div className="empty-state"><ShoppingBag size={36} /><h3>A little empty in here.</h3><p>Find something delicious on our menu.</p><button type="button" className="primary-button mt-4" onClick={() => setOpen(false)}>Explore the menu</button></div> : cart.map((line) => <div key={line.key} className="cart-line"><span><strong>{line.name}</strong><small>{inr(line.price)} each</small>{line.note ? <small>Chef note: {line.note}</small> : null}</span><div className="quantity-control"><button type="button" aria-label={"Remove one " + line.name} onClick={() => changeQty(line.key, -1)}><Minus size={14} /></button><span>{line.qty}</span><button type="button" aria-label={"Add one " + line.name} onClick={() => changeQty(line.key, 1)}><Plus size={14} /></button></div></div>)}{cart.length ? <><div className="cart-subtotal"><span>Food subtotal</span><strong>{inr(total)}</strong></div><label className="mt-5 block text-sm">Delivery address<textarea value={address} onChange={(event) => setAddress(event.target.value)} className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-3" rows={3} placeholder="House, street, area and landmark" /></label><label className="mt-4 block text-sm">Note to the chef<input value={note} onChange={(event) => setNote(event.target.value)} className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-3" placeholder="Any special requests?" /></label><button type="button" onClick={checkout} className="primary-button mt-5 w-full">Place delivery · {inr(total)} <ArrowRight size={17} /></button><p className="mt-3 text-xs leading-relaxed text-[#b7b1a8]">Sign in to place your order. GST and parcel charges are added on the counter bill. Payment is collected on delivery.</p></> : null}</div></div> : null}
    </div>
  );
}
