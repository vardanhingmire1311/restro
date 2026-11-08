"use client";

import { useMemo, useState } from "react";
import { inr } from "@/lib/api";
import type { CartLine, Dish, MenuPayload } from "@/lib/types";

const ORDER = ["Starters", "Tandoori", "Main Course", "Breads", "Rice & Biryani", "Chinese", "Italian", "Continental", "Sandwiches", "Desserts", "Bakery", "Beverages"];

function groups(menu: MenuPayload) {
  const map = new Map<string, Dish[]>();
  for (const category of menu.categories) {
    for (const item of category.items) {
      const key = category.section === "Indian" ? item.uiGroup : category.section === "Mocktails" ? "Beverages" : category.section;
      const list = map.get(key) ?? [];
      list.push(item);
      map.set(key, list);
    }
  }
  const known = ORDER.filter((name) => map.has(name));
  const extra = [...map.keys()].filter((name) => !known.includes(name));
  return [...known, ...extra].map((name) => ({ name, items: map.get(name) ?? [] }));
}

export function MenuPicker({ menu, onAdd }: { menu: MenuPayload; onAdd: (line: CartLine) => void }) {
  const sections = useMemo(() => groups(menu), [menu]);
  const [section, setSection] = useState(sections[0]?.name ?? "");
  const [vegOnly, setVegOnly] = useState(false);
  const [query, setQuery] = useState("");
  const [dish, setDish] = useState<Dish | null>(null);
  const [variantId, setVariantId] = useState<number | undefined>();
  const [options, setOptions] = useState<Record<number, number>>({});
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState("");

  const pool = query.trim()
    ? sections.flatMap((entry) => entry.items)
    : (sections.find((entry) => entry.name === section)?.items ?? []);
  const visible = pool.filter((item) => {
    if (vegOnly && !item.veg) return false;
    if (query && !`${item.name} ${item.menuLine ?? ""} ${item.description ?? ""}`.toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  });

  function open(item: Dish) {
    setDish(item);
    setVariantId(item.variants[0]?.id);
    setOptions({});
    setQty(1);
    setNote("");
  }

  function add() {
    if (!dish) return;
    const variant = dish.variants.find((entry) => entry.id === variantId);
    for (const group of dish.optionGroups) {
      if (group.required && !options[group.id]) return;
    }
    const chosen = dish.optionGroups.flatMap((group) => group.options.filter((option) => option.id === options[group.id]));
    const price = variant?.price ?? dish.price;
    const name = [variant && dish.variants.length && dish.name.includes("/") ? variant.name : dish.name, variant && !dish.name.includes("/") ? variant.name : null, ...chosen.map((option) => option.name)].filter(Boolean).join(" · ");
    const optionIds = chosen.map((option) => option.id);
    onAdd({
      key: `${dish.id}:${variantId ?? ""}:${optionIds.join(",")}:${note}`,
      menuItemId: dish.id,
      name,
      variantId,
      optionIds,
      qty,
      note,
      price,
    });
    setDish(null);
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {sections.map((entry) => (
          <button key={entry.name} type="button" className="chip" data-on={section === entry.name} onClick={() => setSection(entry.name)}>{entry.name}</button>
        ))}
      </div>
      <div className="mt-3 flex gap-2">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search the card" className="glass min-w-0 flex-1 rounded-2xl px-3 py-3 outline-none" />
        <button type="button" className="chip" data-on={vegOnly} onClick={() => setVegOnly((value) => !value)}>Veg</button>
      </div>
      <div className="mt-4 grid gap-2">
        {visible.map((item) => (
          <button key={item.id} type="button" disabled={!item.available} onClick={() => open(item)} className="dish glass flex items-start justify-between gap-3 rounded-2xl px-4 py-3 text-left disabled:opacity-40">
            <span>
              <span className={`mr-2 inline-block h-2.5 w-2.5 rounded-full ${item.veg ? "bg-emerald-400" : "bg-red-500"}`} aria-label={item.veg ? "Vegetarian" : "Non vegetarian"} />
              <span className="font-medium">{item.name}</span>
              {item.description ? <span className="mt-1 block text-sm text-[#b7b1a8]">{item.description}</span> : null}
              {!item.available ? <span className="mt-1 block text-xs text-red-300">86 — not available</span> : null}
            </span>
            <span className="shrink-0 text-[#ff9933]">{item.priceFrom ? "from " : ""}{inr(item.price)}</span>
          </button>
        ))}
        {!visible.length ? <p className="text-[#b7b1a8]">Nothing in this section matches.</p> : null}
      </div>
      {dish ? (
        <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/60 p-3 sm:items-center" role="dialog" aria-modal>
          <div className="glass w-full max-w-lg rounded-3xl p-5">
            <h3 className="display text-2xl">{dish.name}</h3>
            {dish.menuLine && dish.menuLine !== dish.name ? <p className="text-sm text-[#b7b1a8]">{dish.menuLine}</p> : null}
            {dish.variants.length ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {dish.variants.map((variant) => (
                  <button key={variant.id} type="button" className="chip" data-on={variantId === variant.id} onClick={() => setVariantId(variant.id)}>{variant.name} · {inr(variant.price)}</button>
                ))}
              </div>
            ) : null}
            {dish.optionGroups.map((group) => (
              <div key={group.id} className="mt-3">
                <p className="text-sm text-[#ff9933]">{group.name}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {group.options.map((option) => (
                    <button key={option.id} type="button" className="chip" data-on={options[group.id] === option.id} onClick={() => setOptions((current) => ({ ...current, [group.id]: option.id }))}>{option.name}</button>
                  ))}
                </div>
              </div>
            ))}
            <label className="mt-3 block text-sm text-[#b7b1a8]">Note to the chef
              <input value={note} onChange={(event) => setNote(event.target.value)} className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2" />
            </label>
            <div className="mt-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <button type="button" className="h-11 w-11 rounded-full border border-white/15" onClick={() => setQty((value) => Math.max(1, value - 1))}>−</button>
                <span className="w-6 text-center">{qty}</span>
                <button type="button" className="h-11 w-11 rounded-full border border-white/15" onClick={() => setQty((value) => Math.min(50, value + 1))}>+</button>
              </div>
              <div className="flex gap-2">
                <button type="button" className="rounded-full px-4 py-2 text-[#b7b1a8]" onClick={() => setDish(null)}>Close</button>
                <button type="button" className="rounded-full bg-[#ff9933] px-4 py-2 font-semibold text-[#1a1208]" onClick={add}>Add</button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
