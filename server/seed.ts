import bcrypt from "bcryptjs";
import menu from "../menu/menu.json";
import { getPool, withTx } from "./db";

type SeedItem = {
  name: string;
  menuLine?: string;
  description?: string;
  price?: number;
  veg: boolean;
  uiGroup: string;
  station: string;
  variantKind?: string;
  variants?: { name: string; price: number }[];
  optionGroups?: { name: string; required?: boolean; options: string[] }[];
  sort: number;
};

const staff = [
  ["Asha Menon", "admin@restro.com", "admin", "admin123"],
  ["Ravi Iyer", "waiter@restro.com", "waiter", "waiter123"],
  ["Imran Qureshi", "chef@restro.com", "chef", "chef123"],
  ["Neha Kulkarni", "billing@restro.com", "billing", "billing123"],
] as const;

async function putSetting(key: string, value: unknown) {
  await getPool().query(
    `INSERT INTO settings (key, value) VALUES ($1, $2::jsonb)
     ON CONFLICT (key) DO NOTHING`,
    [key, JSON.stringify(value)],
  );
}

export async function seed() {
  await withTx(async (client) => {
    for (const [name, email, role, password] of staff) {
      const existing = await client.query("SELECT id FROM users WHERE email = $1", [email]);
      if (existing.rowCount) continue;
      await client.query(
        `INSERT INTO users (name, email, role, password_hash, password_is_demo) VALUES ($1,$2,$3,$4,true)`,
        [name, email, role, await bcrypt.hash(password, 10)],
      );
    }
    await client.query(
      `INSERT INTO restaurant_tables (table_no)
       SELECT g FROM generate_series(1, 15) AS g
       ON CONFLICT (table_no) DO NOTHING`,
    );
  });

  await putSetting("restaurant_name", "Restro");
  await putSetting("address", "");
  await putSetting("phone", "");
  await putSetting("gstin", "");
  await putSetting("fssai", "");
  await putSetting("gst_rate_bps", 500);
  await putSetting("upi_vpa", "restro@upi");
  await putSetting("upi_payee", "Restro");
  await putSetting("max_discount_percent", 15);
  await putSetting("parcel_charge_paise", 0);
  await putSetting("hours", "12:00–23:30");
  await putSetting("pin_is_demo", true);
  const pin = await getPool().query("SELECT 1 FROM settings WHERE key = 'admin_pin_hash'");
  if (!pin.rowCount) {
    await putSetting("admin_pin_hash", await bcrypt.hash("2580", 10));
  }

  const count = await getPool().query("SELECT count(*)::int AS n FROM menu_items");
  if (Number(count.rows[0]?.n) > 0) {
    console.log("menu already seeded");
    return;
  }

  await withTx(async (client) => {
    let categorySort = 0;
    for (const section of menu.sections) {
      for (const category of section.categories) {
        const inserted = await client.query(
          `INSERT INTO menu_categories (section, name, sort_order) VALUES ($1,$2,$3)
           ON CONFLICT (section, name) DO UPDATE SET sort_order = EXCLUDED.sort_order
           RETURNING id`,
          [section.name, category.name, categorySort++],
        );
        const categoryId = inserted.rows[0].id as number;
        for (const item of category.items as SeedItem[]) {
          const prices = item.variants?.map((variant) => variant.price) ?? [];
          const base = item.price ?? (prices.length ? Math.min(...prices) : null);
          const row = await client.query(
            `INSERT INTO menu_items
              (category_id, name, menu_line, description, is_veg, base_price_paise, variant_kind, station, ui_group, sort_order, source, editable)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'owner_full_menu', true)
             RETURNING id`,
            [
              categoryId,
              item.name,
              item.menuLine ?? item.name,
              item.description ?? null,
              item.veg,
              base == null ? null : Math.round(base * 100),
              item.variantKind ?? null,
              item.station,
              item.uiGroup,
              item.sort,
            ],
          );
          const itemId = row.rows[0].id as number;
          for (const [index, variant] of (item.variants ?? []).entries()) {
            await client.query(
              "INSERT INTO menu_variants (item_id, name, price_paise, sort_order) VALUES ($1,$2,$3,$4)",
              [itemId, variant.name, Math.round(variant.price * 100), index],
            );
          }
          for (const [groupIndex, group] of (item.optionGroups ?? []).entries()) {
            const groupRow = await client.query(
              "INSERT INTO menu_option_groups (item_id, name, required, sort_order) VALUES ($1,$2,$3,$4) RETURNING id",
              [itemId, group.name, group.required !== false, groupIndex],
            );
            for (const [optionIndex, option] of group.options.entries()) {
              await client.query(
                "INSERT INTO menu_options (group_id, name, sort_order) VALUES ($1,$2,$3)",
                [groupRow.rows[0].id, option, optionIndex],
              );
            }
          }
        }
      }
    }
  });
  console.log("seeded menu and staff");
}

const invoked = process.argv[1] && /seed\.ts$/.test(process.argv[1]);
if (invoked) {
  seed().then(() => process.exit(0)).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
