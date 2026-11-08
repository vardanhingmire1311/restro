import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import cors from "cors";
import express, { type Request, type Response } from "express";
import { z } from "zod";
import { actorFromToken, assertAdminPin, audit, bearer, clearCookie, clientIp, customerFromToken, deviceFromUa, loginStaff, revokeSession, setTokenCookie, signCustomer, suspendUser, type Actor } from "./auth";
import { getPool, many, one, withTx } from "./db";
import {
  applyDiscount,
  confirmUpi,
  ingestAggregator,
  kdsTickets,
  listTables,
  payCash,
  pickup,
  placeDelivery,
  placeDineIn,
  presentOrder,
  publicMenu,
  requestBill,
  setItemStatus,
  splitBill,
  voidItem,
  type ItemInput,
} from "./domain";
import { AppError, asyncRoute, ok, parseBody, sendError } from "./errors";
import { inrToPaise, rupees } from "./money";
import { analytics, chargeMock, closeDrawer, confirmPhonePe, confirmStripe, drawerState, gatewayFlags, openDrawer, sessionPublic, startCard, sticker, upiQr, verifyRazorpay } from "./payments";
import { sendOtp } from "./sms";
import { loadSettings, saveSettings } from "./settings";

const itemInput = z.object({
  menuItemId: z.number().int().positive(),
  variantId: z.number().int().positive().optional(),
  optionIds: z.array(z.number().int().positive()).max(8).optional(),
  qty: z.number().int().min(1).max(50),
  note: z.string().max(240).optional(),
});

function param(value: string | string[] | undefined) {
  const picked = Array.isArray(value) ? value[0] : value;
  if (!picked) throw new AppError(400, "validation", "Missing id");
  return picked;
}

function meta(req: Request) {
  return { ip: clientIp(req), device: deviceFromUa(req.header("user-agent")), ua: req.header("user-agent") || "" };
}

async function requireStaff(req: Request, roles?: Actor["role"][]) {
  const actor = await actorFromToken(bearer(req, "restro_token"));
  if (!actor) throw new AppError(401, "auth", "Sign in required");
  if (roles && !roles.includes(actor.role)) throw new AppError(403, "forbidden", "Your role cannot do that");
  return actor;
}

async function requireGuest(req: Request) {
  const customer = await customerFromToken(bearer(req, "restro_guest"));
  if (!customer) throw new AppError(401, "auth", "Sign in to book a table or order delivery");
  return customer;
}

function appBase() {
  return (process.env.APP_URL || "http://127.0.0.1:3847").replace(/\/$/, "");
}

function webhookSignature(req: Request) {
  const secret = process.env.AGGREGATOR_WEBHOOK_SECRET;
  const header = req.header("x-webhook-signature") || "";
  const raw = (req as Request & { rawBody?: Buffer }).rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
  if (!secret) {
    if (process.env.NODE_ENV === "production" && process.env.ALLOW_OPEN_WEBHOOKS !== "true") {
      throw new AppError(401, "signature", "Set AGGREGATOR_WEBHOOK_SECRET before accepting partner webhooks");
    }
    return { ok: false, skipped: true };
  }
  const expected = crypto.createHmac("sha256", secret).update(raw).digest("hex");
  const left = Buffer.from(header);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) {
    throw new AppError(401, "signature", "Signature does not match");
  }
  return { ok: true, skipped: false };
}

const aggregatorBody = z.object({
  delivery_id: z.string().min(3).max(40),
  customer_name: z.string().max(80).optional(),
  chef_note: z.string().max(240).optional(),
  parcel_charge: z.number().min(0).max(500).optional(),
  items: z.array(z.object({
    menuItemId: z.number().int().positive().optional(),
    variantId: z.number().int().positive().optional(),
    optionIds: z.array(z.number().int()).optional(),
    name: z.string().min(1).max(120).optional(),
    qty: z.number().int().min(1).max(50),
    price: z.number().min(0).optional(),
    note: z.string().max(240).optional(),
  })).min(1).max(40),
});

async function takeAggregator(partner: "SWIGGY" | "ZOMATO", req: Request) {
  const body = parseBody(aggregatorBody, req.body);
  const signature = webhookSignature(req);
  const result = await ingestAggregator(partner, body, signature, req.body);
  const order = await presentOrder(getPool(), result.orderId);
  return { idempotent: result.idempotent, order };
}

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(cors({ origin: process.env.CLIENT_ORIGIN ? process.env.CLIENT_ORIGIN.split(",") : true, credentials: true }));
  app.use(express.json({
    limit: "256kb",
    verify: (req, _res, buf) => {
      (req as Request & { rawBody?: Buffer }).rawBody = Buffer.from(buf);
    },
  }));
  app.use("/api", (_req, res, next) => {
    res.setHeader("cache-control", "no-store");
    next();
  });

  app.get("/api/health", asyncRoute(async (_req, res) => {
    await getPool().query("SELECT 1");
    ok(res, { service: "restro", database: true });
  }));

  app.get("/api/public/config", asyncRoute(async (_req, res) => {
    const settings = await loadSettings(getPool());
    ok(res, {
      restaurant: { name: settings.restaurantName, address: settings.address, phone: settings.phone, hours: settings.hours },
      google: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
      payments: gatewayFlags(),
      otpDevReveal: process.env.OTP_DEV_REVEAL === "true" && process.env.NODE_ENV !== "production",
    });
  }));

  app.get("/api/public/menu", asyncRoute(async (_req, res) => {
    ok(res, await publicMenu());
  }));

  app.post("/api/auth/login", asyncRoute(async (req, res) => {
    const body = parseBody(z.object({ email: z.string().email(), password: z.string().min(1).max(80) }), req.body);
    const info = meta(req);
    const result = await loginStaff({ email: body.email, password: body.password }, info);
    setTokenCookie(res, "restro_token", result.token, 60 * 60 * 12);
    ok(res, result);
  }));

  app.post("/api/auth/logout", asyncRoute(async (req, res) => {
    const actor = await requireStaff(req);
    const info = meta(req);
    await revokeSession(actor.jti, "logout", actor, info);
    clearCookie(res, "restro_token");
    ok(res, { signedOut: true });
  }));

  app.get("/api/auth/me", asyncRoute(async (req, res) => {
    ok(res, await requireStaff(req));
  }));

  app.post("/api/auth/password", asyncRoute(async (req, res) => {
    const actor = await requireStaff(req);
    const body = parseBody(z.object({ current: z.string().min(1), next: z.string().min(8).max(80) }), req.body);
    const row = await one<{ password_hash: string }>(getPool(), "SELECT password_hash FROM users WHERE id = $1", [actor.id]);
    if (!row || !(await bcrypt.compare(body.current, row.password_hash))) throw new AppError(401, "credentials", "Current password is wrong");
    await getPool().query("UPDATE users SET password_hash = $2, password_is_demo = false, updated_at = now() WHERE id = $1", [actor.id, await bcrypt.hash(body.next, 10)]);
    await audit(getPool(), { actorId: actor.id, actorEmail: actor.email, action: "password.change", ip: meta(req).ip, device: meta(req).device });
    ok(res, { changed: true });
  }));

  app.post("/api/auth/verify-pin", asyncRoute(async (req, res) => {
    await requireStaff(req, ["waiter", "admin"]);
    const body = parseBody(z.object({ pin: z.string().min(4).max(8) }), req.body);
    await assertAdminPin(body.pin);
    ok(res, { verified: true });
  }));

  app.get("/api/tables", asyncRoute(async (req, res) => {
    await requireStaff(req);
    const rows = await listTables();
    ok(res, rows.map((row) => ({
      tableNo: row.table_no as number,
      status: row.status as string,
      guests: row.guest_count as number | null,
      orderId: row.current_order_id as string | null,
      orderNo: row.order_no as number | null,
      total: row.total_paise == null ? 0 : rupees(Number(row.total_paise)),
      billStatus: row.bill_status as string | null,
    })));
  }));

  app.post("/api/orders", asyncRoute(async (req, res) => {
    const actor = await requireStaff(req, ["waiter", "admin"]);
    const body = parseBody(z.object({
      tableNo: z.number().int().min(1).max(15),
      guests: z.number().int().min(1).max(20).optional(),
      chefNote: z.string().max(240).optional(),
      items: z.array(itemInput).min(1).max(40),
    }), req.body);
    ok(res, await placeDineIn(actor, body, meta(req)), 201);
  }));

  app.get("/api/orders/:id", asyncRoute(async (req, res) => {
    const actor = await requireStaff(req);
    if (actor.role === "chef") throw new AppError(403, "forbidden", "Kitchen does not see bills");
    ok(res, await presentOrder(getPool(), param(req.params.id)));
  }));

  app.post("/api/orders/:id/bill-request", asyncRoute(async (req, res) => {
    const actor = await requireStaff(req, ["waiter", "admin", "billing"]);
    ok(res, await requestBill(actor, param(req.params.id)));
  }));

  app.post("/api/order-items/:id/void", asyncRoute(async (req, res) => {
    const actor = await requireStaff(req, ["waiter", "admin"]);
    const body = parseBody(z.object({ pin: z.string().min(4).max(8).optional() }), req.body ?? {});
    if (actor.role === "waiter") {
      if (!body.pin) throw new AppError(403, "pin", "An admin PIN is required to void a dish");
      await assertAdminPin(body.pin);
    }
    ok(res, await voidItem(actor, param(req.params.id), meta(req)));
  }));

  app.patch("/api/order-items/:id/status", asyncRoute(async (req, res) => {
    const actor = await requireStaff(req, ["chef", "admin"]);
    const body = parseBody(z.object({ status: z.enum(["PREPARING", "READY"]) }), req.body);
    ok(res, await setItemStatus(actor, param(req.params.id), body.status));
  }));

  app.get("/api/kds", asyncRoute(async (req, res) => {
    await requireStaff(req, ["chef", "admin"]);
    const partner = typeof req.query.partner === "string" ? req.query.partner.toUpperCase() : undefined;
    ok(res, await kdsTickets(partner));
  }));

  app.get("/api/billing/orders", asyncRoute(async (req, res) => {
    await requireStaff(req, ["billing", "admin"]);
    const rows = await many<{ id: string }>(getPool(), "SELECT id FROM orders WHERE status = 'OPEN' ORDER BY created_at DESC");
    const orders = [];
    for (const row of rows) orders.push(await presentOrder(getPool(), row.id));
    ok(res, orders);
  }));

  app.post("/api/billing/orders/:id/discount", asyncRoute(async (req, res) => {
    const actor = await requireStaff(req, ["billing", "admin"]);
    const body = parseBody(z.object({
      mode: z.enum(["percent", "flat"]),
      value: z.number().min(0),
      reason: z.string().min(2).max(120),
    }), req.body);
    ok(res, await applyDiscount(actor, param(req.params.id), body, meta(req)));
  }));

  app.post("/api/billing/orders/:id/split", asyncRoute(async (req, res) => {
    const actor = await requireStaff(req, ["billing", "admin"]);
    const body = parseBody(z.object({
      parts: z.array(z.object({ label: z.string().min(1).max(40), amount: z.number().positive() })).min(2).max(6),
    }), req.body);
    ok(res, await splitBill(actor, param(req.params.id), body.parts, meta(req)));
  }));

  app.post("/api/billing/shares/:id/cash", asyncRoute(async (req, res) => {
    const actor = await requireStaff(req, ["billing", "admin"]);
    const body = parseBody(z.object({ tendered: z.number().positive() }), req.body);
    ok(res, await payCash(actor, param(req.params.id), body.tendered, meta(req)));
  }));

  app.get("/api/billing/shares/:id/upi", asyncRoute(async (req, res) => {
    await requireStaff(req, ["billing", "admin"]);
    ok(res, await upiQr(param(req.params.id)));
  }));

  app.post("/api/billing/shares/:id/upi", asyncRoute(async (req, res) => {
    const actor = await requireStaff(req, ["billing", "admin"]);
    ok(res, await confirmUpi(actor, param(req.params.id), meta(req)));
  }));

  app.post("/api/billing/shares/:id/card", asyncRoute(async (req, res) => {
    const actor = await requireStaff(req, ["billing", "admin"]);
    const body = parseBody(z.object({ gateway: z.enum(["mock", "razorpay", "stripe", "phonepe", "paytm"]) }), req.body);
    ok(res, await startCard(actor, param(req.params.id), body.gateway));
  }));

  app.get("/api/billing/drawer", asyncRoute(async (req, res) => {
    await requireStaff(req, ["billing", "admin"]);
    ok(res, await drawerState());
  }));

  app.post("/api/billing/drawer/open", asyncRoute(async (req, res) => {
    const actor = await requireStaff(req, ["billing", "admin"]);
    const body = parseBody(z.object({ float: z.number().min(0) }), req.body);
    ok(res, await openDrawer(actor, body.float, meta(req)));
  }));

  app.post("/api/billing/drawer/close", asyncRoute(async (req, res) => {
    const actor = await requireStaff(req, ["billing", "admin"]);
    const body = parseBody(z.object({ counted: z.number().min(0), note: z.string().max(160).optional() }), req.body);
    ok(res, await closeDrawer(actor, body.counted, body.note, meta(req)));
  }));

  app.get("/api/billing/orders/:id/sticker", asyncRoute(async (req, res) => {
    await requireStaff(req, ["billing", "admin"]);
    ok(res, await sticker(param(req.params.id)));
  }));

  app.post("/api/billing/simulate", asyncRoute(async (req, res) => {
    await requireStaff(req, ["billing", "admin"]);
    const body = parseBody(z.object({
      partner: z.enum(["SWIGGY", "ZOMATO"]),
      deliveryId: z.string().min(3).max(40).optional(),
    }), req.body);
    const deliveryId = body.deliveryId || (body.partner === "SWIGGY" ? "SWG-8821" : "ZOM-4490");
    const sandwich = await one<{ id: number }>(getPool(), "SELECT id FROM menu_items WHERE name = 'Vegetarian Sandwich' ORDER BY id LIMIT 1");
    const rice = await one<{ id: number }>(getPool(), "SELECT id FROM menu_items WHERE name = 'Veg. Fried Rice' ORDER BY id LIMIT 1");
    if (!sandwich || !rice) throw new AppError(500, "menu", "Seed menu is missing sample dishes");
    const payload = {
      delivery_id: deliveryId,
      customer_name: body.partner === "SWIGGY" ? "Swiggy guest" : "Zomato guest",
      chef_note: "Leave at the parcel counter",
      items: [
        { menuItemId: sandwich.id, qty: 1, note: "no onion" },
        { menuItemId: rice.id, qty: 1 },
      ],
    };
    const result = await ingestAggregator(body.partner, payload, { ok: false, skipped: true }, { ...payload, simulated: true });
    ok(res, { idempotent: result.idempotent, order: await presentOrder(getPool(), result.orderId) });
  }));

  app.post("/api/webhooks/swiggy", asyncRoute(async (req, res) => {
    ok(res, await takeAggregator("SWIGGY", req));
  }));

  app.post("/api/webhooks/zomato", asyncRoute(async (req, res) => {
    ok(res, await takeAggregator("ZOMATO", req));
  }));

  app.post("/api/pickup", asyncRoute(async (req, res) => {
    const actor = await requireStaff(req, ["billing", "admin"]);
    const body = parseBody(z.object({ deliveryId: z.string().min(3).max(40) }), req.body);
    ok(res, await pickup(body.deliveryId, actor, meta(req)));
  }));

  app.post("/api/payments/mock/charge", asyncRoute(async (req, res) => {
    const body = parseBody(z.object({
      sessionId: z.string().uuid(),
      number: z.string().min(12).max(24),
      expiry: z.string().min(4).max(7),
      name: z.string().min(2).max(80),
    }), req.body);
    ok(res, await chargeMock(body.sessionId, { number: body.number, expiry: body.expiry, name: body.name }));
  }));

  app.get("/api/payments/sessions/:id", asyncRoute(async (req, res) => {
    ok(res, await sessionPublic(param(req.params.id)));
  }));

  app.post("/api/payments/razorpay/verify", asyncRoute(async (req, res) => {
    const body = parseBody(z.object({
      sessionId: z.string().uuid(),
      razorpay_order_id: z.string().min(4),
      razorpay_payment_id: z.string().min(4),
      razorpay_signature: z.string().min(8),
    }), req.body);
    ok(res, await verifyRazorpay(body.sessionId, body));
  }));

  app.post("/api/payments/stripe/confirm", asyncRoute(async (req, res) => {
    const body = parseBody(z.object({ sessionId: z.string().min(8) }), req.body);
    ok(res, await confirmStripe(body.sessionId));
  }));

  app.post("/api/payments/phonepe/confirm", asyncRoute(async (req, res) => {
    const body = parseBody(z.object({ sessionId: z.string().uuid() }), req.body);
    ok(res, await confirmPhonePe(body.sessionId));
  }));

  app.post("/api/payments/phonepe/callback", asyncRoute(async (_req, res) => {
    ok(res, { received: true });
  }));

  app.get("/api/admin/staff", asyncRoute(async (req, res) => {
    await requireStaff(req, ["admin"]);
    ok(res, await many(getPool(), "SELECT id, name, email, role, is_suspended, password_is_demo, created_at FROM users ORDER BY role, email"));
  }));

  app.post("/api/admin/staff", asyncRoute(async (req, res) => {
    const actor = await requireStaff(req, ["admin"]);
    const body = parseBody(z.object({
      name: z.string().min(2).max(80),
      email: z.string().email(),
      role: z.enum(["admin", "waiter", "chef", "billing"]),
      password: z.string().min(8).max(80),
    }), req.body);
    const row = await one(getPool(), "INSERT INTO users (name, email, role, password_hash) VALUES ($1,$2,$3,$4) RETURNING id, name, email, role", [
      body.name, body.email.toLowerCase(), body.role, await bcrypt.hash(body.password, 10),
    ]);
    await audit(getPool(), { actorId: actor.id, actorEmail: actor.email, action: "staff.create", entityId: String((row as { id: string }).id), ip: meta(req).ip, device: meta(req).device });
    ok(res, row, 201);
  }));

  app.post("/api/admin/staff/:id/suspend", asyncRoute(async (req, res) => {
    const actor = await requireStaff(req, ["admin"]);
    await suspendUser(param(req.params.id), true, actor, meta(req));
    ok(res, { suspended: true });
  }));

  app.post("/api/admin/staff/:id/activate", asyncRoute(async (req, res) => {
    const actor = await requireStaff(req, ["admin"]);
    await suspendUser(param(req.params.id), false, actor, meta(req));
    ok(res, { suspended: false });
  }));

  app.get("/api/admin/sessions", asyncRoute(async (req, res) => {
    await requireStaff(req, ["admin"]);
    ok(res, await many(getPool(), `
      SELECT s.id, s.jti, s.ip, s.device, s.user_agent, s.created_at, s.last_seen_at, s.expires_at, s.revoked_at, u.email, u.name, u.role
      FROM sessions s JOIN users u ON u.id = s.user_id
      ORDER BY s.created_at DESC LIMIT 100`));
  }));

  app.post("/api/admin/sessions/:jti/revoke", asyncRoute(async (req, res) => {
    const actor = await requireStaff(req, ["admin"]);
    await revokeSession(param(req.params.jti), "admin", actor, meta(req));
    ok(res, { revoked: true });
  }));

  app.get("/api/admin/audit", asyncRoute(async (req, res) => {
    await requireStaff(req, ["admin"]);
    ok(res, await many(getPool(), "SELECT id, actor_email, action, entity_type, entity_id, details, ip, device, created_at FROM audit_logs ORDER BY id DESC LIMIT 150"));
  }));

  app.get("/api/admin/analytics", asyncRoute(async (req, res) => {
    await requireStaff(req, ["admin"]);
    const today = new Date().toLocaleDateString("en-CA", { timeZone: process.env.TZ || "Asia/Kolkata" });
    const from = typeof req.query.from === "string" ? req.query.from : today;
    const to = typeof req.query.to === "string" ? req.query.to : today;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw new AppError(400, "date", "Use YYYY-MM-DD dates");
    ok(res, await analytics(from, to));
  }));

  app.get("/api/admin/settings", asyncRoute(async (req, res) => {
    await requireStaff(req, ["admin"]);
    const settings = await loadSettings(getPool());
    ok(res, { ...settings, adminPinHash: undefined, pinIsDemo: settings.pinIsDemo, payments: gatewayFlags() });
  }));

  app.put("/api/admin/settings", asyncRoute(async (req, res) => {
    const actor = await requireStaff(req, ["admin"]);
    const body = parseBody(z.object({
      restaurantName: z.string().min(2).max(80).optional(),
      address: z.string().max(200).optional(),
      phone: z.string().max(30).optional(),
      gstin: z.string().max(20).optional(),
      fssai: z.string().max(20).optional(),
      gstRatePercent: z.number().min(0).max(28).optional(),
      upiVpa: z.string().min(3).max(80).optional(),
      upiPayee: z.string().min(2).max(80).optional(),
      maxDiscountPercent: z.number().min(0).max(100).optional(),
      parcelCharge: z.number().min(0).max(500).optional(),
      hours: z.string().max(60).optional(),
    }), req.body);
    const patch: Record<string, unknown> = {};
    if (body.restaurantName) patch.restaurant_name = body.restaurantName;
    if (body.address !== undefined) patch.address = body.address;
    if (body.phone !== undefined) patch.phone = body.phone;
    if (body.gstin !== undefined) patch.gstin = body.gstin;
    if (body.fssai !== undefined) patch.fssai = body.fssai;
    if (body.gstRatePercent !== undefined) patch.gst_rate_bps = Math.round(body.gstRatePercent * 100);
    if (body.upiVpa) patch.upi_vpa = body.upiVpa;
    if (body.upiPayee) patch.upi_payee = body.upiPayee;
    if (body.maxDiscountPercent !== undefined) patch.max_discount_percent = body.maxDiscountPercent;
    if (body.parcelCharge !== undefined) patch.parcel_charge_paise = inrToPaise(body.parcelCharge);
    if (body.hours) patch.hours = body.hours;
    await saveSettings(getPool(), patch);
    await audit(getPool(), { actorId: actor.id, actorEmail: actor.email, action: "settings.update", details: patch, ip: meta(req).ip, device: meta(req).device });
    const settings = await loadSettings(getPool());
    ok(res, { ...settings, adminPinHash: undefined });
  }));

  app.post("/api/admin/pin", asyncRoute(async (req, res) => {
    const actor = await requireStaff(req, ["admin"]);
    const body = parseBody(z.object({ current: z.string().min(4).max(8), next: z.string().regex(/^\d{4,6}$/) }), req.body);
    await assertAdminPin(body.current);
    await saveSettings(getPool(), { admin_pin_hash: await bcrypt.hash(body.next, 10), pin_is_demo: false });
    await audit(getPool(), { actorId: actor.id, actorEmail: actor.email, action: "pin.change", ip: meta(req).ip, device: meta(req).device });
    ok(res, { changed: true });
  }));

  app.get("/api/admin/menu", asyncRoute(async (req, res) => {
    await requireStaff(req, ["admin"]);
    ok(res, await publicMenu());
  }));

  app.post("/api/admin/menu/items", asyncRoute(async (req, res) => {
    const actor = await requireStaff(req, ["admin"]);
    const body = parseBody(z.object({
      categoryId: z.number().int().positive(),
      name: z.string().min(2).max(120),
      price: z.number().positive(),
      veg: z.boolean(),
      station: z.string().min(2).max(40).optional(),
    }), req.body);
    const category = await one<{ section: string; name: string }>(getPool(), "SELECT section, name FROM menu_categories WHERE id = $1", [body.categoryId]);
    if (!category) throw new AppError(404, "category", "Category not found");
    const row = await one(getPool(), `
      INSERT INTO menu_items (category_id, name, menu_line, is_veg, base_price_paise, station, ui_group, is_available, sort_order, source, editable)
      VALUES ($1,$2,$2,$3,$4,$5,$6,true,(SELECT COALESCE(MAX(sort_order),0)+1 FROM menu_items), 'added', true)
      RETURNING id`, [body.categoryId, body.name, body.veg, inrToPaise(body.price), body.station || "indian", category.name]);
    await audit(getPool(), { actorId: actor.id, actorEmail: actor.email, action: "menu.create", entityId: String((row as { id: number }).id), details: body, ip: meta(req).ip, device: meta(req).device });
    ok(res, row, 201);
  }));

  app.patch("/api/admin/menu/items/:id", asyncRoute(async (req, res) => {
    const actor = await requireStaff(req, ["admin"]);
    const body = parseBody(z.object({
      name: z.string().min(2).max(120).optional(),
      description: z.string().max(240).nullable().optional(),
      price: z.number().positive().optional(),
      available: z.boolean().optional(),
    }), req.body);
    const current = await one<{ id: number; base_price_paise: number | null; name: string }>(getPool(), "SELECT id, base_price_paise, name FROM menu_items WHERE id = $1", [param(req.params.id)]);
    if (!current) throw new AppError(404, "not_found", "Dish not found");
    await getPool().query(
      `UPDATE menu_items SET
         name = COALESCE($2, name),
         description = COALESCE($3, description),
         base_price_paise = COALESCE($4, base_price_paise),
         is_available = COALESCE($5, is_available),
         updated_at = now()
       WHERE id = $1`,
      [param(req.params.id), body.name ?? null, body.description ?? null, body.price == null ? null : inrToPaise(body.price), body.available ?? null],
    );
    await audit(getPool(), { actorId: actor.id, actorEmail: actor.email, action: "menu.update", entityId: param(req.params.id), details: { before: current, after: body }, ip: meta(req).ip, device: meta(req).device });
    ok(res, { updated: true });
  }));

  app.patch("/api/admin/variants/:id", asyncRoute(async (req, res) => {
    const actor = await requireStaff(req, ["admin"]);
    const body = parseBody(z.object({ name: z.string().min(1).max(80).optional(), price: z.number().positive().optional() }), req.body);
    const row = await one(getPool(), "SELECT id, price_paise, name FROM menu_variants WHERE id = $1", [param(req.params.id)]);
    if (!row) throw new AppError(404, "not_found", "Variant not found");
    await getPool().query("UPDATE menu_variants SET name = COALESCE($2, name), price_paise = COALESCE($3, price_paise) WHERE id = $1", [
      param(req.params.id), body.name ?? null, body.price == null ? null : inrToPaise(body.price),
    ]);
    await audit(getPool(), { actorId: actor.id, actorEmail: actor.email, action: "menu.price", entityId: param(req.params.id), details: { before: row, after: body }, ip: meta(req).ip, device: meta(req).device });
    ok(res, { updated: true });
  }));

  app.get("/api/admin/bookings", asyncRoute(async (req, res) => {
    await requireStaff(req, ["admin", "billing"]);
    ok(res, await many(getPool(), "SELECT id, guest_name, mobile, party_size, booking_date, booking_time, notes, status, created_at FROM bookings ORDER BY booking_date, booking_time"));
  }));

  app.patch("/api/admin/bookings/:id", asyncRoute(async (req, res) => {
    const actor = await requireStaff(req, ["admin"]);
    const body = parseBody(z.object({ status: z.enum(["requested", "confirmed", "cancelled", "seated"]) }), req.body);
    await getPool().query("UPDATE bookings SET status = $2 WHERE id = $1", [param(req.params.id), body.status]);
    await audit(getPool(), { actorId: actor.id, actorEmail: actor.email, action: "booking.update", entityId: param(req.params.id), details: body, ip: meta(req).ip, device: meta(req).device });
    ok(res, { updated: true });
  }));

  app.post("/api/customer/otp/request", asyncRoute(async (req, res) => {
    const body = parseBody(z.object({ name: z.string().min(2).max(80), mobile: z.string().regex(/^[6-9]\d{9}$/) }), req.body);
    const recent = await one<{ created_at: string }>(getPool(), "SELECT created_at FROM otp_challenges WHERE mobile = $1 ORDER BY created_at DESC LIMIT 1", [body.mobile]);
    if (recent && Date.now() - new Date(recent.created_at).getTime() < 30_000) throw new AppError(429, "otp", "Wait a few seconds before asking for another code");
    const code = String(crypto.randomInt(100000, 1000000));
    const hash = crypto.createHash("sha256").update(`${code}:${body.mobile}:${process.env.JWT_SECRET || "dev-only-restro-secret-change-me"}`).digest("hex");
    await getPool().query("INSERT INTO otp_challenges (mobile, name, code_hash, expires_at) VALUES ($1,$2,$3, now() + interval '5 minutes')", [body.mobile, body.name.trim(), hash]);
    const channel = await sendOtp(body.mobile, code);
    const reveal = process.env.OTP_DEV_REVEAL === "true" && process.env.NODE_ENV !== "production";
    ok(res, { sent: true, channel, devCode: reveal ? code : undefined });
  }));

  app.post("/api/customer/otp/verify", asyncRoute(async (req, res) => {
    const body = parseBody(z.object({ mobile: z.string().regex(/^[6-9]\d{9}$/), code: z.string().regex(/^\d{6}$/) }), req.body);
    const challenge = await one<{ id: string; name: string; code_hash: string; attempts: number }>(
      getPool(),
      "SELECT id, name, code_hash, attempts FROM otp_challenges WHERE mobile = $1 AND consumed_at IS NULL AND expires_at > now() ORDER BY created_at DESC LIMIT 1",
      [body.mobile],
    );
    if (!challenge) throw new AppError(400, "otp", "That code has expired. Ask for a new one.");
    if (challenge.attempts >= 5) throw new AppError(429, "otp", "Too many attempts. Ask for a new code.");
    const hash = crypto.createHash("sha256").update(`${body.code}:${body.mobile}:${process.env.JWT_SECRET || "dev-only-restro-secret-change-me"}`).digest("hex");
    if (hash !== challenge.code_hash) {
      await getPool().query("UPDATE otp_challenges SET attempts = attempts + 1 WHERE id = $1", [challenge.id]);
      throw new AppError(401, "otp", "That code is wrong");
    }
    const customer = await withTx(async (client) => {
      await client.query("UPDATE otp_challenges SET consumed_at = now() WHERE id = $1", [challenge.id]);
      const existing = await one<{ id: string; name: string; mobile: string | null }>(client, "SELECT id, name, mobile FROM customers WHERE mobile = $1", [body.mobile]);
      if (existing) {
        await client.query("UPDATE customers SET name = $2 WHERE id = $1", [existing.id, challenge.name]);
        return { id: existing.id, name: challenge.name, mobile: body.mobile };
      }
      const created = await one<{ id: string }>(client, "INSERT INTO customers (name, mobile) VALUES ($1,$2) RETURNING id", [challenge.name, body.mobile]);
      return { id: created!.id, name: challenge.name, mobile: body.mobile };
    });
    const signed = signCustomer(customer);
    await getPool().query("INSERT INTO sessions (jti, customer_id, ip, user_agent, device, expires_at) VALUES ($1,$2,$3,$4,$5, to_timestamp($6))", [
      signed.jti, customer.id, meta(req).ip, meta(req).ua, meta(req).device, signed.exp,
    ]);
    setTokenCookie(res, "restro_guest", signed.token, 60 * 60 * 24 * 30);
    ok(res, { token: signed.token, customer });
  }));

  app.get("/api/customer/google/start", asyncRoute(async (_req, res) => {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      res.redirect("/account?google=missing");
      return;
    }
    const state = crypto.randomUUID();
    await getPool().query("INSERT INTO google_states (state) VALUES ($1)", [state]);
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", `${appBase()}/api/customer/google/callback`);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "openid email profile");
    url.searchParams.set("state", state);
    res.redirect(url.toString());
  }));

  app.get("/api/customer/google/callback", asyncRoute(async (req, res) => {
    const code = typeof req.query.code === "string" ? req.query.code : "";
    const state = typeof req.query.state === "string" ? req.query.state : "";
    const saved = await one(getPool(), "DELETE FROM google_states WHERE state = $1 RETURNING state", [state]);
    if (!saved || !code) {
      res.redirect("/account?google=failed");
      return;
    }
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID || "",
        client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
        redirect_uri: `${appBase()}/api/customer/google/callback`,
        grant_type: "authorization_code",
      }),
    });
    const tokenBody = (await tokenResponse.json().catch(() => null)) as { access_token?: string } | null;
    if (!tokenResponse.ok || !tokenBody?.access_token) {
      res.redirect("/account?google=failed");
      return;
    }
    const profileResponse = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", { headers: { authorization: `Bearer ${tokenBody.access_token}` } });
    const profile = (await profileResponse.json().catch(() => null)) as { sub?: string; name?: string; email?: string } | null;
    if (!profile?.sub) {
      res.redirect("/account?google=failed");
      return;
    }
    const name = profile.name || "Guest";
    let customer = await one<{ id: string; name: string; mobile: string | null }>(getPool(), "SELECT id, name, mobile FROM customers WHERE google_sub = $1", [profile.sub]);
    if (!customer) {
      customer = await one<{ id: string; name: string; mobile: string | null }>(getPool(), "INSERT INTO customers (name, email, google_sub) VALUES ($1,$2,$3) RETURNING id, name, mobile", [name, profile.email ?? null, profile.sub]);
    }
    if (!customer) {
      res.redirect("/account?google=failed");
      return;
    }
    const signed = signCustomer(customer);
    await getPool().query("INSERT INTO sessions (jti, customer_id, ip, user_agent, device, expires_at) VALUES ($1,$2,$3,$4,$5, to_timestamp($6))", [
      signed.jti, customer.id, meta(req).ip, meta(req).ua, meta(req).device, signed.exp,
    ]);
    setTokenCookie(res, "restro_guest", signed.token, 60 * 60 * 24 * 30);
    res.redirect(`/account?google=ok&token=${encodeURIComponent(signed.token)}`);
  }));

  app.get("/api/customer/me", asyncRoute(async (req, res) => {
    ok(res, await requireGuest(req));
  }));

  app.post("/api/customer/logout", asyncRoute(async (req, res) => {
    const token = bearer(req, "restro_guest");
    const customer = await customerFromToken(token);
    if (customer && token) {
      const payload = JSON.parse(Buffer.from(token.split(".")[1] || "", "base64url").toString() || "{}") as { jti?: string };
      if (payload.jti) await getPool().query("UPDATE sessions SET revoked_at = now(), revoke_reason = 'logout' WHERE jti = $1", [payload.jti]);
    }
    clearCookie(res, "restro_guest");
    ok(res, { signedOut: true });
  }));

  app.post("/api/customer/mobile", asyncRoute(async (req, res) => {
    const customer = await requireGuest(req);
    const body = parseBody(z.object({ mobile: z.string().regex(/^[6-9]\d{9}$/) }), req.body);
    await getPool().query("UPDATE customers SET mobile = $2 WHERE id = $1", [customer.id, body.mobile]);
    ok(res, { ...customer, mobile: body.mobile });
  }));

  app.post("/api/customer/bookings", asyncRoute(async (req, res) => {
    const customer = await requireGuest(req);
    const body = parseBody(z.object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      time: z.string().regex(/^\d{2}:\d{2}$/),
      partySize: z.number().int().min(1).max(12),
      notes: z.string().max(240).optional(),
      mobile: z.string().regex(/^[6-9]\d{9}$/).optional(),
    }), req.body);
    const mobile = body.mobile || customer.mobile;
    if (!mobile) throw new AppError(400, "mobile", "Add a mobile number so the desk can confirm the table");
    if (!customer.mobile && body.mobile) await getPool().query("UPDATE customers SET mobile = $2 WHERE id = $1", [customer.id, body.mobile]);
    const minutes = Number(body.time.slice(3));
    const hour = Number(body.time.slice(0, 2));
    if (minutes % 30 !== 0 || hour < 12 || hour > 23) throw new AppError(400, "time", "Pick a half-hour slot between 12:00 and 23:00");
    const taken = await one<{ n: number }>(getPool(), "SELECT count(*)::int AS n FROM bookings WHERE booking_date = $1 AND booking_time = $2 AND status <> 'cancelled'", [body.date, body.time]);
    if ((taken?.n ?? 0) >= 15) throw new AppError(409, "full", "That sitting is full. Try another time.");
    const row = await one(getPool(), `
      INSERT INTO bookings (customer_id, guest_name, mobile, party_size, booking_date, booking_time, notes)
      VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, booking_date, booking_time, party_size, status`, [
      customer.id, customer.name, mobile, body.partySize, body.date, body.time, body.notes ?? null,
    ]);
    ok(res, row, 201);
  }));

  app.get("/api/customer/bookings", asyncRoute(async (req, res) => {
    const customer = await requireGuest(req);
    ok(res, await many(getPool(), "SELECT id, guest_name, party_size, booking_date, booking_time, notes, status, created_at FROM bookings WHERE customer_id = $1 ORDER BY booking_date DESC, booking_time DESC", [customer.id]));
  }));

  app.post("/api/customer/delivery", asyncRoute(async (req, res) => {
    const customer = await requireGuest(req);
    const body = parseBody(z.object({
      address: z.string().min(8).max(240),
      chefNote: z.string().max(240).optional(),
      items: z.array(itemInput).min(1).max(40),
    }), req.body);
    ok(res, await placeDelivery(customer, { ...body, items: body.items as ItemInput[] }), 201);
  }));

  app.get("/api/customer/orders", asyncRoute(async (req, res) => {
    const customer = await requireGuest(req);
    const rows = await many<{ id: string }>(getPool(), "SELECT id FROM orders WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 20", [customer.id]);
    const orders = [];
    for (const row of rows) orders.push(await presentOrder(getPool(), row.id));
    ok(res, orders);
  }));

  app.use("/api", (_req, res) => {
    res.status(404).json({ ok: false, error: { code: "not_found", message: "That API path does not exist" } });
  });

  app.use((error: unknown, _req: Request, res: Response, next: express.NextFunction) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    sendError(res, error);
  });

  return app;
}
