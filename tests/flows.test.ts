import crypto from "node:crypto";
import request from "supertest";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../server/app";
import { getPool } from "../server/db";
import { migrate } from "../server/migrate";
import { seed } from "../server/seed";

const app = createApp();

async function login(email: string) {
  const password = email.startsWith("admin") ? "admin123" : email.startsWith("waiter") ? "waiter123" : email.startsWith("chef") ? "chef123" : "billing123";
  const response = await request(app).post("/api/auth/login").send({ email, password });
  expect(response.status).toBe(200);
  return response.body.data.token as string;
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

type Dish = { id: number; name: string; variants: { id: number; name: string; price: number }[]; optionGroups: { id: number; name: string; options: { id: number; name: string }[] }[] };

async function menuIndex() {
  const response = await request(app).get("/api/public/menu");
  expect(response.status).toBe(200);
  const dishes: Dish[] = [];
  for (const category of response.body.data.categories) dishes.push(...category.items);
  return {
    dishes,
    find(name: string) {
      const dish = dishes.find((item) => item.name === name);
      if (!dish) throw new Error(`missing ${name}`);
      return dish;
    },
  };
}

beforeAll(async () => {
  await migrate();
  await seed();
});

beforeEach(async () => {
  await getPool().query(`
    TRUNCATE payments, payment_sessions, bill_shares, bills, order_items, kots, aggregator_orders, orders,
      bookings, otp_challenges, audit_logs, sessions, drawer_shifts, google_states RESTART IDENTITY CASCADE
  `);
  await getPool().query("UPDATE restaurant_tables SET status = 'available', current_order_id = NULL, guest_count = NULL, opened_at = NULL");
  await getPool().query("UPDATE users SET is_suspended = false");
});

describe("menu seed", () => {
  it("uses the owner menu, with variants and options, and no invented paneer butter masala", async () => {
    const menu = await menuIndex();
    const chicken = menu.find("Tandoori Chicken");
    expect(chicken.variants.map((variant) => `${variant.name}:${variant.price}`).sort()).toEqual(["Full:520", "Half:275"]);
    const paneer = menu.find("Choice of Paneer");
    expect(paneer.optionGroups[0].options.some((option) => option.name === "Butter Masala")).toBe(true);
    expect(menu.dishes.some((dish) => dish.name === "Paneer Butter Masala")).toBe(false);
    const pasta = menu.find("Vegetable Pasta");
    expect(pasta.optionGroups.map((group) => group.name).sort()).toEqual(["Sauce", "Shape"]);
    expect(menu.dishes.length).toBeGreaterThan(250);
  });
});

describe("service flow", () => {
  it("logs a failed sign-in and rejects a waiter from billing", async () => {
    const failed = await request(app).post("/api/auth/login").send({ email: "waiter@restro.com", password: "wrong" });
    expect(failed.status).toBe(401);
    const admin = await login("admin@restro.com");
    const audit = await request(app).get("/api/admin/audit").set(auth(admin));
    expect(audit.body.data.some((row: { action: string; ip: string | null }) => row.action === "login.failed")).toBe(true);
    const waiter = await login("waiter@restro.com");
    const blocked = await request(app).post("/api/billing/drawer/open").set(auth(waiter)).send({ float: 1000 });
    expect(blocked.status).toBe(403);
  });

  it("sends an order to the kitchen, prices the half tandoori, and lets the chef finish it without seeing prices", async () => {
    const menu = await menuIndex();
    const waiter = await login("waiter@restro.com");
    const chef = await login("chef@restro.com");
    const chicken = menu.find("Tandoori Chicken");
    const half = chicken.variants.find((variant) => variant.name === "Half");
    const placed = await request(app).post("/api/orders").set(auth(waiter)).send({
      tableNo: 5,
      chefNote: "less oil",
      items: [{ menuItemId: chicken.id, variantId: half?.id, qty: 1, note: "well done" }],
    });
    expect(placed.status).toBe(201);
    expect(placed.body.data.bill.total).toBe(288.75);
    expect(placed.body.data.bill.paymentStatus).toBe("UNSETTLED");
    expect(placed.body.data.bill.items[0].note).toBe("well done");
    const kds = await request(app).get("/api/kds").set(auth(chef));
    expect(kds.status).toBe(200);
    expect(JSON.stringify(kds.body.data)).not.toMatch(/"price"/);
    expect(kds.body.data[0].chefNote).toBe("less oil");
    expect(kds.body.data[0].items[0].note).toBe("well done");
    const itemId = kds.body.data[0].items[0].id as string;
    const cooking = await request(app).patch(`/api/order-items/${itemId}/status`).set(auth(chef)).send({ status: "PREPARING" });
    const ready = await request(app).patch(`/api/order-items/${itemId}/status`).set(auth(chef)).send({ status: "READY" });
    expect(cooking.status).toBe(200);
    expect(ready.body.data.status).toBe("READY");
    const chefBill = await request(app).get(`/api/orders/${placed.body.data.orderId}`).set(auth(chef));
    expect(chefBill.status).toBe(403);
  });

  it("voids only with the admin PIN, then splits the bill across two sandbox cards", async () => {
    const menu = await menuIndex();
    const waiter = await login("waiter@restro.com");
    const billing = await login("billing@restro.com");
    const sandwich = menu.find("Vegetarian Sandwich");
    const rice = menu.find("Veg. Fried Rice");
    const placed = await request(app).post("/api/orders").set(auth(waiter)).send({
      tableNo: 4,
      items: [
        { menuItemId: sandwich.id, qty: 2 },
        { menuItemId: rice.id, qty: 1 },
      ],
    });
    expect(placed.status).toBe(201);
    const riceLine = placed.body.data.bill.items.find((item: { name: string }) => item.name === "Veg. Fried Rice");
    const denied = await request(app).post(`/api/order-items/${riceLine.id}/void`).set(auth(waiter)).send({});
    expect(denied.status).toBe(403);
    const removed = await request(app).post(`/api/order-items/${riceLine.id}/void`).set(auth(waiter)).send({ pin: "2580" });
    expect(removed.status).toBe(200);
    expect(removed.body.data.total).toBe(126);
    const settle = await request(app).post(`/api/billing/shares/${removed.body.data.shares[0].id}/cash`).set(auth(waiter)).send({ tendered: 200 });
    expect(settle.status).toBe(403);
    const split = await request(app).post(`/api/billing/orders/${placed.body.data.orderId}/split`).set(auth(billing)).send({
      parts: [
        { label: "Card 1", amount: 63 },
        { label: "Card 2", amount: 63 },
      ],
    });
    expect(split.status).toBe(200);
    for (const share of split.body.data.shares) {
      const session = await request(app).post(`/api/billing/shares/${share.id}/card`).set(auth(billing)).send({ gateway: "mock" });
      expect(session.status).toBe(200);
      const paid = await request(app).post("/api/payments/mock/charge").send({
        sessionId: session.body.data.sessionId,
        number: "4111111111111111",
        expiry: "12/30",
        name: "Test Guest",
      });
      expect(paid.status).toBe(200);
      expect(JSON.stringify(paid.body)).not.toContain("4111111111111111");
    }
    const tables = await request(app).get("/api/tables").set(auth(waiter));
    expect(tables.body.data.find((table: { tableNo: number }) => table.tableNo === 4).status).toBe("available");
    const columns = await getPool().query("SELECT column_name FROM information_schema.columns WHERE table_name = 'payments'");
    const names = columns.rows.map((row) => row.column_name as string);
    expect(names).not.toContain("card_number");
    expect(names).not.toContain("cvv");
    const stored = await getPool().query("SELECT card_last4, card_brand, status FROM payments WHERE status = 'success'");
    expect(stored.rows.every((row) => row.card_last4 === "1111" && row.card_brand === "visa")).toBe(true);
  });

  it("declines a sandbox card without settling, and reconciles the cash drawer", async () => {
    const menu = await menuIndex();
    const waiter = await login("waiter@restro.com");
    const billing = await login("billing@restro.com");
    const placed = await request(app).post("/api/orders").set(auth(waiter)).send({
      tableNo: 2,
      items: [{ menuItemId: menu.find("Gulab Jamun").id, qty: 1 }],
    });
    const shareId = placed.body.data.bill.shares[0].id as string;
    const early = await request(app).post(`/api/billing/shares/${shareId}/cash`).set(auth(billing)).send({ tendered: 200 });
    expect(early.status).toBe(409);
    await request(app).post("/api/billing/drawer/open").set(auth(billing)).send({ float: 500 });
    const session = await request(app).post(`/api/billing/shares/${shareId}/card`).set(auth(billing)).send({ gateway: "mock" });
    const declined = await request(app).post("/api/payments/mock/charge").send({
      sessionId: session.body.data.sessionId,
      number: "4000000000000002",
      expiry: "12/30",
      name: "Test Guest",
    });
    expect(declined.status).toBe(402);
    const cash = await request(app).post(`/api/billing/shares/${shareId}/cash`).set(auth(billing)).send({ tendered: 200 });
    expect(cash.status).toBe(200);
    expect(cash.body.data.paymentStatus).toBe("PAID");
    const closed = await request(app).post("/api/billing/drawer/close").set(auth(billing)).send({ counted: 594.5, note: "evening" });
    expect(closed.body.data.open).toBeNull();
    expect(closed.body.data.recent[0].variance).toBe(0);
  });

  it("imports a Swiggy parcel once, prints a prepaid sticker, and records pickup", async () => {
    const menu = await menuIndex();
    const billing = await login("billing@restro.com");
    const chef = await login("chef@restro.com");
    const payload = { delivery_id: "SWG-8821", items: [{ menuItemId: menu.find("Vegetarian Sandwich").id, qty: 1 }], chef_note: "extra tissue" };
    const first = await request(app).post("/api/webhooks/swiggy").send(payload);
    const second = await request(app).post("/api/webhooks/swiggy").send(payload);
    expect(first.status).toBe(200);
    expect(second.body.data.idempotent).toBe(true);
    expect(second.body.data.order.orderId).toBe(first.body.data.order.orderId);
    expect(first.body.data.order.paymentStatus).toBe("PREPAID");
    const kds = await request(app).get("/api/kds?partner=SWIGGY").set(auth(chef));
    expect(kds.body.data[0].parcel).toBe(true);
    expect(kds.body.data[0].deliveryId).toBe("SWG-8821");
    const sticker = await request(app).get(`/api/billing/orders/${first.body.data.order.orderId}/sticker`).set(auth(billing));
    expect(sticker.body.data.deliveryId).toBe("SWG-8821");
    expect(sticker.body.data.prepaid).toBe(true);
    expect(sticker.body.data.barcode.startsWith("data:image/png")).toBe(true);
    expect(sticker.body.data).toHaveProperty("fssai");
    expect(sticker.body.data).toHaveProperty("gstin");
    const tooSoon = await request(app).post("/api/pickup").set(auth(billing)).send({ deliveryId: "SWG-8821" });
    expect(tooSoon.status).toBe(409);
    const itemId = kds.body.data[0].items[0].id as string;
    await request(app).patch(`/api/order-items/${itemId}/status`).set(auth(chef)).send({ status: "PREPARING" });
    await request(app).patch(`/api/order-items/${itemId}/status`).set(auth(chef)).send({ status: "READY" });
    const picked = await request(app).post("/api/pickup").set(auth(billing)).send({ deliveryId: "SWG-8821" });
    expect(picked.body.data.status).toBe("PICKED_UP");
  });

  it("rejects a bad aggregator signature when a secret is configured", async () => {
    process.env.AGGREGATOR_WEBHOOK_SECRET = "partner-secret";
    const menu = await menuIndex();
    const body = { delivery_id: "ZOM-4490", items: [{ menuItemId: menu.find("Gulab Jamun").id, qty: 1 }] };
    const missing = await request(app).post("/api/webhooks/zomato").send(body);
    expect(missing.status).toBe(401);
    const raw = JSON.stringify(body);
    const signature = crypto.createHmac("sha256", "partner-secret").update(raw).digest("hex");
    const signed = await request(app).post("/api/webhooks/zomato").set("content-type", "application/json").set("x-webhook-signature", signature).send(raw);
    expect(signed.status).toBe(200);
    delete process.env.AGGREGATOR_WEBHOOK_SECRET;
  });

  it("suspends a waiter and kills the open session", async () => {
    const admin = await login("admin@restro.com");
    const waiterToken = await login("waiter@restro.com");
    const staff = await request(app).get("/api/admin/staff").set(auth(admin));
    const waiter = staff.body.data.find((user: { email: string }) => user.email === "waiter@restro.com");
    const suspended = await request(app).post(`/api/admin/staff/${waiter.id}/suspend`).set(auth(admin));
    expect(suspended.status).toBe(200);
    const me = await request(app).get("/api/auth/me").set(auth(waiterToken));
    expect(me.status).toBe(401);
    const again = await request(app).post("/api/auth/login").send({ email: "waiter@restro.com", password: "waiter123" });
    expect(again.status).toBe(403);
  });

  it("stops billing from editing the menu", async () => {
    const billing = await login("billing@restro.com");
    const menu = await menuIndex();
    const response = await request(app).patch(`/api/admin/menu/items/${menu.find("Gulab Jamun").id}`).set(auth(billing)).send({ price: 10 });
    expect(response.status).toBe(403);
  });
});
