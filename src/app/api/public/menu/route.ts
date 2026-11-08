import { NextResponse } from "next/server";
import menuData from "@/../menu/menu.json";

type SeedOptionGroup = { name: string; required?: boolean; options: string[] };
type SeedVariant = { name: string; price: number };
type SeedItem = {
  name: string;
  menuLine?: string;
  description?: string;
  price?: number;
  veg: boolean;
  uiGroup: string;
  station: string;
  variants?: SeedVariant[];
  optionGroups?: SeedOptionGroup[];
};

function buildCompiledMenu() {
  let categoryId = 1;
  let itemId = 1;
  let variantId = 1;
  let groupId = 1;
  let optionId = 1;

  const categories = [];

  for (const section of menuData.sections) {
    for (const category of section.categories) {
      const catId = categoryId++;
      const items = [];
      for (const item of category.items as SeedItem[]) {
        const itId = itemId++;
        const itemVariants = (item.variants || []).map((v) => ({
          id: variantId++,
          name: v.name,
          price: v.price,
        }));
        const prices = itemVariants.length ? itemVariants.map((v) => v.price) : [item.price || 0];
        const optionGroups = (item.optionGroups || []).map((g) => ({
          id: groupId++,
          name: g.name,
          required: g.required !== false,
          options: (g.options || []).map((opt) => ({ id: optionId++, name: opt })),
        }));

        items.push({
          id: itId,
          name: item.name,
          menuLine: item.menuLine || item.name,
          description: item.description || null,
          veg: item.veg,
          available: true,
          station: item.station,
          uiGroup: item.uiGroup,
          price: Math.min(...prices),
          priceFrom: itemVariants.length > 1,
          variants: itemVariants,
          optionGroups,
        });
      }
      categories.push({
        id: catId,
        section: section.name,
        name: category.name,
        items,
      });
    }
  }

  return {
    restaurant: {
      name: "Restro",
      address: "15, Dining Room Lane, Pune",
      phone: "+91 98765 43210",
      hours: "12:00–23:30",
    },
    categories,
  };
}

export async function GET() {
  if (process.env.DATABASE_URL) {
    try {
      const { publicMenu } = await import("@/../server/domain");
      const data = await publicMenu();
      return NextResponse.json(
        { ok: true, data },
        { headers: { "cache-control": "no-store, max-age=0" } }
      );
    } catch {
      // Fall through to compiled menu if database is unreachable
    }
  }

  return NextResponse.json(
    { ok: true, data: buildCompiledMenu() },
    { headers: { "cache-control": "no-store, max-age=0" } }
  );
}
