"use client";

import Image from "next/image";
import { useMemo, useState } from "react";
import { Search, X, Minus, Plus } from "lucide-react";
import { inr } from "@/lib/api";
import { categoryImage, foodImage } from "@/lib/food-images";
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
      <div className="category-rail">
        {sections.map((entry) => (
          <button
            key={entry.name}
            type="button"
            className="category-chip"
            data-on={section === entry.name}
            onClick={() => setSection(entry.name)}
          >
            <Image
              src={categoryImage(entry.name)}
              alt=""
              width={36}
              height={36}
              loading="lazy"
            />
            <span>{entry.name}</span>
          </button>
        ))}
      </div>

      <div className="menu-tools">
        <div className="search-field glass">
          <Search size={16} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search the menu..."
          />
        </div>
        <button
          type="button"
          className="chip veg-filter"
          data-on={vegOnly}
          onClick={() => setVegOnly((value) => !value)}
        >
          <span className="inline-block h-2 w-2 rounded-full bg-emerald-400" />
          <span>Veg only</span>
        </button>
      </div>

      <div className="menu-section-title">
        <h3 className="display">{query ? "Search Results" : section}</h3>
        <span>{visible.length} {visible.length === 1 ? "dish" : "dishes"}</span>
      </div>

      <div className="menu-grid">
        {visible.map((item) => (
          <button
            key={item.id}
            type="button"
            disabled={!item.available}
            onClick={() => open(item)}
            className="food-card glass text-left disabled:opacity-40"
          >
            <div className="food-card-photo">
              <Image
                src={foodImage(item.name, item.uiGroup)}
                alt={item.name}
                fill
                sizes="(max-width: 640px) 100vw, (max-width: 1100px) 50vw, 33vw"
                loading="lazy"
              />
              <div className={`food-badge ${item.veg ? "is-veg" : "is-nonveg"}`}>
                <span />
                {item.veg ? "VEG" : "NON-VEG"}
              </div>
            </div>
            <div className="food-card-body">
              <h4 className="food-card-name">{item.name}</h4>
              {item.description ? <p className="food-description">{item.description}</p> : null}
              {!item.available ? <span className="text-xs text-red-300">86 — not available</span> : null}
              <div className="food-card-bottom">
                <span className="food-price">{item.priceFrom ? "from " : ""}{inr(item.price)}</span>
                <span className="add-circle" aria-hidden="true">+</span>
              </div>
            </div>
          </button>
        ))}
        {!visible.length ? <p className="col-span-full py-8 text-center text-[#b7b1a8]">Nothing in this section matches.</p> : null}
      </div>

      {dish ? (
        <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/70 p-3 sm:items-center" role="dialog" aria-modal>
          <div className="dish-dialog glass w-full max-w-lg overflow-hidden rounded-3xl">
            <div className="dialog-photo">
              <Image
                src={foodImage(dish.name, dish.uiGroup)}
                alt={dish.name}
                fill
                sizes="(max-width: 640px) 100vw, 512px"
              />
              <button
                type="button"
                className="dialog-close text-white"
                aria-label="Close"
                onClick={() => setDish(null)}
              >
                <X size={18} />
              </button>
            </div>
            <div className="p-5">
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
                <div className="quantity-control">
                  <button type="button" aria-label="Decrease quantity" onClick={() => setQty((value) => Math.max(1, value - 1))}><Minus size={14} /></button>
                  <span>{qty}</span>
                  <button type="button" aria-label="Increase quantity" onClick={() => setQty((value) => Math.min(50, value + 1))}><Plus size={14} /></button>
                </div>
                <div className="flex gap-2">
                  <button type="button" className="rounded-full px-4 py-2 text-[#b7b1a8]" onClick={() => setDish(null)}>Close</button>
                  <button type="button" className="rounded-full bg-[#ff9933] px-5 py-2 font-semibold text-[#1a1208]" onClick={add}>Add · {inr((dish.variants.find((v) => v.id === variantId)?.price ?? dish.price) * qty)}</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
