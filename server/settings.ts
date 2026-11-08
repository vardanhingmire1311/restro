import type { Sql } from "./db";
import { one } from "./db";

export type Settings = {
  restaurantName: string;
  address: string;
  phone: string;
  gstin: string;
  fssai: string;
  gstRateBps: number;
  upiVpa: string;
  upiPayee: string;
  maxDiscountPercent: number;
  parcelChargePaise: number;
  adminPinHash: string;
  pinIsDemo: boolean;
  hours: string;
};

type SettingRow = { key: string; value: unknown };

export async function loadSettings(sql: Sql): Promise<Settings> {
  try {
    const rows = await sql.query<SettingRow>("SELECT key, value FROM settings");
    const map = new Map(rows.rows.map((row) => [row.key, row.value]));
    const text = (key: string, fallback = "") => {
      const value = map.get(key);
      return typeof value === "string" ? value : fallback;
    };
    const num = (key: string, fallback: number) => {
      const value = map.get(key);
      return typeof value === "number" ? value : fallback;
    };
    return {
      restaurantName: text("restaurant_name", "Restro"),
      address: text("address"),
      phone: text("phone"),
      gstin: text("gstin"),
      fssai: text("fssai"),
      gstRateBps: num("gst_rate_bps", 500),
      upiVpa: text("upi_vpa", "restro@upi"),
      upiPayee: text("upi_payee", "Restro"),
      maxDiscountPercent: num("max_discount_percent", 15),
      parcelChargePaise: num("parcel_charge_paise", 0),
      adminPinHash: text("admin_pin_hash"),
      pinIsDemo: map.get("pin_is_demo") === true,
      hours: text("hours", "12:00–23:30"),
    };
  } catch {
    return {
      restaurantName: "Restro",
      address: "15, Dining Room Lane, Pune",
      phone: "+91 98765 43210",
      gstin: "",
      fssai: "",
      gstRateBps: 500,
      upiVpa: "restro@upi",
      upiPayee: "Restro",
      maxDiscountPercent: 15,
      parcelChargePaise: 0,
      adminPinHash: "",
      pinIsDemo: true,
      hours: "12:00–23:30",
    };
  }
}

export async function saveSettings(sql: Sql, patch: Record<string, unknown>) {
  for (const [key, value] of Object.entries(patch)) {
    await sql.query(
      `INSERT INTO settings (key, value) VALUES ($1, $2::jsonb)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [key, JSON.stringify(value)],
    );
  }
}

export async function settingValue(sql: Sql, key: string) {
  const row = await one<{ value: unknown }>(sql, "SELECT value FROM settings WHERE key = $1", [key]);
  return row?.value ?? null;
}
