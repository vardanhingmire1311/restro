/**
 * Compiles menu/menu.source.md (the owner's 10-page transcription)
 * into menu/menu.json. The JSON file is the only menu seed.
 *
 * Rules (also documented in the README):
 * - A trailing "a/b" price becomes variants with those exact prices.
 * - "Choice of … (opt / opt)" becomes one item plus a required option group.
 * - Parenthetical short slash-lists at one price become options (cakes, prawns styles).
 * - A slash in the dish name at one price becomes variants. When the print
 *   shares a leading or trailing word ("Cream of Tomato / Veg.", "Malai / Matka Kulfi"),
 *   that word is repeated onto each variant so the kitchen ticket names a dish.
 *   The original printed line is kept on menuLine.
 * - Pasta uses two option groups: shape and sauce, from the category heading.
 * - Spellings are copied as printed (Cupsium, Tripple, Sez, Hydrabadi, …).
 */
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const source = fs.readFileSync(path.join(root, "menu/menu.source.md"), "utf8");

const CAKE_FLAVOURS = [
  "Black forest",
  "Pineapple",
  "Butterscotch",
  "Mango",
  "Strawberry",
  "Vanilla",
  "Orange",
  "Irish coffee",
];

function sectionId(heading) {
  const h = heading.toLowerCase();
  if (h.startsWith("indian")) return "Indian";
  if (h.startsWith("chinese")) return "Chinese";
  if (h.startsWith("italian")) return "Italian";
  if (h.startsWith("continental")) return "Continental";
  if (h.startsWith("dessert")) return "Desserts";
  if (h.startsWith("bakery")) return "Bakery";
  if (h.startsWith("mocktail")) return "Mocktails";
  if (h.includes("sandwich") || h.includes("favourite") || h.includes("favorite")) return "Sandwiches";
  return heading.trim();
}

function isVeg(section, category, name) {
  const c = category.toLowerCase();
  if (c.includes("non veg") || c.includes("non-veg")) return false;
  if (c.includes("(chicken)") || c === "fish" || c === "chicken") return false;
  if (section === "Indian" && /^eggs?\b/i.test(name)) return false;
  if (/(chicken|mutton|prawn|fish|shrimp|poulet|scotch broth)/i.test(name)) return false;
  if (/\beggs?\b/i.test(name) && !/less/i.test(name)) return false;
  return true;
}

function uiGroup(section, category, name) {
  if (section === "Indian") {
    const c = category.toLowerCase();
    if (c.includes("bread")) return "Breads";
    if (c.includes("rice")) return "Rice & Biryani";
    if (c.includes("dal") || c.includes("main")) return "Main Course";
    if (/tandoori|tikka|kabab|kebab|sheek|seekh|tangdi|reshami/i.test(name)) return "Tandoori";
    return "Starters";
  }
  if (section === "Desserts") return "Desserts";
  if (section === "Mocktails") return "Beverages";
  if (section === "Bakery") return "Bakery";
  if (section === "Sandwiches") return category;
  return category;
}

function stationFor(section, group) {
  if (group === "Tandoori") return "tandoor";
  if (section === "Chinese") return "chinese";
  if (section === "Italian") return "italian";
  if (section === "Continental") return "continental";
  if (section === "Bakery") return "bakery";
  if (section === "Desserts") return "dessert";
  if (section === "Mocktails") return "bar";
  if (section === "Sandwiches") return "sandwich";
  return "indian";
}

function expandSlash(parts) {
  if (parts.every((p) => p.split(/\s+/).length >= 2)) return parts;
  const lastWords = parts[parts.length - 1].split(/\s+/);
  if (lastWords.length >= 2 && parts.slice(0, -1).every((p) => p.split(/\s+/).length === 1)) {
    const suffix = lastWords.slice(1).join(" ");
    return [
      ...parts.slice(0, -1).map((p) => `${p} ${suffix}`),
      parts[parts.length - 1],
    ];
  }
  const firstWords = parts[0].split(/\s+/);
  if (firstWords.length >= 2 && parts.slice(1).every((p) => p.split(/\s+/).length === 1)) {
    const prefix = firstWords.slice(0, -1).join(" ");
    return parts.map((p, i) => (i === 0 ? p : `${prefix} ${p}`));
  }
  if (parts.every((p) => p.split(/\s+/).length === 1) && parts.length >= 2) {
    const noun = parts[parts.length - 1];
    return parts.map((p, i) => (i === parts.length - 1 ? p : `${p} ${noun}`));
  }
  return parts;
}

function shortParts(inner) {
  const parts = inner.split("/").map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const descriptive = /topped|stuffed|deep fried|farm fresh|sauce|with |olives|peppers|herbed|minced/i;
  if (parts.some((p) => p.length > 32 || descriptive.test(p) || p.split(/\s+/).length > 5)) return null;
  return parts;
}

function classify(rawLine, pasta) {
  const line = rawLine.replace(/\s+/g, " ").trim().replace(/[.;]+$/, "");
  if (!line) return null;
  const priceMatch = line.match(/^(.*?)(?:\s+)(\d+(?:\/\d+)+|\d+)\s*$/);
  if (!priceMatch) throw new Error(`No price on line: ${line}`);
  const printed = priceMatch[1].trim();
  const prices = priceMatch[2].split("/").map((n) => Number(n));

  if (pasta) {
    return {
      name: printed,
      menuLine: printed,
      price: prices[0],
      optionGroups: [
        { name: "Shape", required: true, options: pasta.shapes },
        { name: "Sauce", required: true, options: pasta.sauces },
      ],
    };
  }

  const choice = printed.match(/^Choice of\s+(.+?)\s*\((.+)\)\s*$/i);
  if (choice && prices.length === 1) {
    const options = choice[2].split("/").map((s) => s.trim());
    return {
      name: `Choice of ${choice[1].trim()}`,
      menuLine: printed,
      price: prices[0],
      optionGroups: [{ name: "Choice", required: true, options }],
    };
  }

  const paren = printed.match(/^(.*?)\s*\((.+)\)\s*$/);
  if (paren) {
    const base = paren[1].trim();
    const inner = paren[2].trim();
    if (/same flavours/i.test(inner) && prices.length === 1) {
      return {
        name: base || "Pastries",
        menuLine: printed,
        description: "Same flavours as egg less cake.",
        price: prices[0],
        optionGroups: [{ name: "Flavour", required: true, options: [...CAKE_FLAVOURS] }],
      };
    }
    const parts = shortParts(inner);
    if (parts && prices.length === parts.length) {
      return {
        name: base,
        menuLine: printed,
        variantKind: "portion",
        variants: parts.map((name, i) => ({ name, price: prices[i] })),
      };
    }
    if (parts && prices.length === 1) {
      const group = /cake|pastr/i.test(base) ? "Flavour" : "Style";
      return {
        name: base,
        menuLine: printed,
        price: prices[0],
        optionGroups: [{ name: group, required: true, options: parts }],
      };
    }
    return {
      name: base || printed,
      menuLine: printed,
      description: inner,
      price: prices[0],
    };
  }

  if (printed.includes("/") && prices.length === 1) {
    const parts = expandSlash(printed.split("/").map((s) => s.trim()));
    return {
      name: printed,
      menuLine: printed,
      variantKind: "dish",
      variants: parts.map((name) => ({ name, price: prices[0] })),
    };
  }

  if (printed.includes("/") && prices.length > 1) {
    const parts = printed.split("/").map((s) => s.trim());
    if (parts.length === prices.length) {
      return {
        name: printed,
        menuLine: printed,
        variants: parts.map((name, i) => ({ name, price: prices[i] })),
      };
    }
  }

  return { name: printed, menuLine: printed, price: prices[0] };
}

const lines = source.split(/\r?\n/);
let section = null;
let category = null;
let pasta = null;
let buffer = [];
const categories = [];

function categoryFromHeading(heading, sectionName) {
  if (sectionName === "Sandwiches") {
    const match = heading.match(/Sandwiches.*$/i);
    return match ? match[0] : "Sandwiches";
  }
  return sectionName;
}

function flush() {
  if (!category) {
    buffer = [];
    return;
  }
  // A new line in the transcription is a new dish. Semicolons separate dishes on one line.
  const text = buffer.join(";");
  buffer = [];
  const chunks = text.split(";").map((s) => s.trim()).filter(Boolean);
  const items = [];
  for (const chunk of chunks) {
    const item = classify(chunk, pasta);
    if (!item) continue;
    items.push({
      ...item,
      veg: isVeg(section, category.name, item.name),
      uiGroup: uiGroup(section, category.name, item.name),
      station: stationFor(section, uiGroup(section, category.name, item.name)),
    });
  }
  if (items.length) categories.push({ ...category, items });
}

for (const line of lines) {
  if (line.startsWith("# ")) continue;
  if (line.startsWith("## ")) {
    flush();
    const heading = line.slice(3).trim();
    section = sectionId(heading);
    category = { section, name: categoryFromHeading(heading, section) };
    pasta = null;
    continue;
  }
  if (line.startsWith("### ")) {
    flush();
    const heading = line.slice(4).trim();
    const pastaMatch = heading.match(/^Pasta\s*\(choose\s+(.+?)\s*\+\s*sauce\s+(.+)\)$/i);
    if (pastaMatch) {
      category = { section, name: "Pasta" };
      pasta = {
        shapes: pastaMatch[1].split("/").map((s) => s.trim()),
        sauces: pastaMatch[2].split("/").map((s) => s.trim()).map((s) => s.replace(/\)\s*$/, "")),
      };
    } else {
      category = { section, name: heading };
      pasta = null;
    }
    continue;
  }
  if (category) buffer.push(line);
}
flush();

let sort = 0;
const sections = [];
for (const cat of categories) {
  let bucket = sections.find((s) => s.name === cat.section);
  if (!bucket) {
    bucket = { name: cat.section, categories: [] };
    sections.push(bucket);
  }
  bucket.categories.push({
    name: cat.name,
    items: cat.items.map((item) => ({ ...item, sort: sort++ })),
  });
}

const menu = {
  version: 1,
  currency: "INR",
  source: "Owner 10-page menu transcription (menu/menu.source.md). Spellings are as printed. This file is the only menu seed.",
  compiledBy: "scripts/compile-menu.mjs",
  variantRule: "Slash prices and slash dish names are variants. The printed line is menuLine.",
  optionRule: "Choice-of lines, same-price style lists, cake flavours, and pasta shape + sauce are selectable options and do not change the price.",
  sections,
};

const out = path.join(root, "menu/menu.json");
fs.writeFileSync(out, JSON.stringify(menu, null, 2) + "\n");

const items = sections.flatMap((s) => s.categories.flatMap((c) => c.items));
const withVariants = items.filter((i) => i.variants?.length);
const withOptions = items.filter((i) => i.optionGroups?.length);
console.log(sections.map((s) => `${s.name}:${s.categories.reduce((n, c) => n + c.items.length, 0)}`).join(" "));
console.log(`sections ${sections.length} categories ${categories.length} items ${items.length} variants ${withVariants.length} options ${withOptions.length}`);
for (const i of [...withVariants, ...withOptions]) {
  const extra = i.variants
    ? i.variants.map((v) => `${v.name}=${v.price}`).join(", ")
    : i.optionGroups.map((g) => `${g.name}[${g.options.join("|")}]`).join(" + ");
  console.log(`- [${i.veg ? "V" : "N"}] ${i.uiGroup} :: ${i.name} :: ${extra}`);
}
