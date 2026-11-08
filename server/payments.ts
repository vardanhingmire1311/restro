import crypto from "node:crypto";
import QRCode from "qrcode";
import bwipjs from "bwip-js";
import { getPool, one, withTx } from "./db";
import { AppError } from "./errors";
import { emitFloor } from "./io";
import { rupees } from "./money";
import { loadSettings } from "./settings";
import { audit, type Actor } from "./auth";
import { markSharePaid, presentOrder } from "./domain";

export function gatewayFlags() {
  return {
    mock: true,
    upi: true,
    razorpay: Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET),
    stripe: Boolean(process.env.STRIPE_SECRET_KEY),
    phonepe: Boolean(process.env.PHONEPE_MERCHANT_ID && process.env.PHONEPE_SALT),
    // upipay@1.0.0 exists but has a single June 2026 release. We do not depend on it.
    // Paytm checksum initiation is not bundled; the adapter refuses rather than pretending.
    paytm: false,
  };
}

function appUrl() {
  return (process.env.APP_URL || "http://127.0.0.1:3847").replace(/\/$/, "");
}

async function openShare(shareId: string) {
  const share = await one<{ id: string; amount_paise: number; status: string; bill_id: string; order_id: string; label: string }>(
    getPool(),
    `SELECT s.id, s.amount_paise, s.status, s.bill_id, s.label, b.order_id
     FROM bill_shares s JOIN bills b ON b.id = s.bill_id WHERE s.id = $1`,
    [shareId],
  );
  if (!share) throw new AppError(404, "not_found", "Bill share not found");
  if (share.status === "PAID") throw new AppError(409, "paid", "That share is already paid");
  return share;
}

export async function startCard(actor: Actor, shareId: string, gateway: string) {
  const flags = gatewayFlags();
  if (gateway === "paytm") {
    throw new AppError(501, "not_configured", "Paytm Business is not enabled. The upipay package is a single unmaintained release, so this build does not claim Paytm checkout. Use UPI QR, Razorpay test, Stripe test, or the sandbox card page.");
  }
  if (gateway === "razorpay" && !flags.razorpay) throw new AppError(501, "not_configured", "Razorpay test keys are not set");
  if (gateway === "stripe" && !flags.stripe) throw new AppError(501, "not_configured", "Stripe test secret is not set");
  if (gateway === "phonepe" && !flags.phonepe) throw new AppError(501, "not_configured", "PhonePe merchant id and salt are not set");
  if (!["mock", "razorpay", "stripe", "phonepe"].includes(gateway)) throw new AppError(400, "gateway", "Unknown card gateway");

  const share = await openShare(shareId);
  const session = await one<{ id: string }>(
    getPool(),
    `INSERT INTO payment_sessions (bill_share_id, order_id, gateway, amount_paise, status, expires_at)
     VALUES ($1,$2,$3,$4,'PENDING', now() + interval '30 minutes') RETURNING id`,
    [share.id, share.order_id, gateway, share.amount_paise],
  );
  if (!session) throw new AppError(500, "payment", "Could not open the card session");

  if (gateway === "mock") {
    return { redirectUrl: `${appUrl()}/pay/sandbox/${session.id}`, sessionId: session.id, gateway };
  }
  if (gateway === "razorpay") {
    const key = process.env.RAZORPAY_KEY_ID || "";
    const secret = process.env.RAZORPAY_KEY_SECRET || "";
    const response = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString("base64")}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ amount: share.amount_paise, currency: "INR", receipt: session.id }),
    });
    const body = (await response.json().catch(() => null)) as { id?: string; error?: { description?: string } } | null;
    if (!response.ok || !body?.id) throw new AppError(502, "razorpay", body?.error?.description || "Razorpay did not open an order");
    await getPool().query("UPDATE payment_sessions SET provider_ref = $2 WHERE id = $1", [session.id, body.id]);
    return { redirectUrl: `${appUrl()}/pay/razorpay/${session.id}`, sessionId: session.id, gateway, keyId: key, razorpayOrderId: body.id, amount: share.amount_paise };
  }
  if (gateway === "stripe") {
    const params = new URLSearchParams();
    params.set("mode", "payment");
    params.set("success_url", `${appUrl()}/pay/return?gateway=stripe&session_id={CHECKOUT_SESSION_ID}`);
    params.set("cancel_url", `${appUrl()}/billing?card=cancel`);
    params.set("line_items[0][quantity]", "1");
    params.set("line_items[0][price_data][currency]", "inr");
    params.set("line_items[0][price_data][unit_amount]", String(share.amount_paise));
    params.set("line_items[0][price_data][product_data][name]", `Restro ${share.label}`);
    params.set("metadata[share_id]", share.id);
    params.set("metadata[payment_session]", session.id);
    const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`, "content-type": "application/x-www-form-urlencoded" },
      body: params,
    });
    const body = (await response.json().catch(() => null)) as { id?: string; url?: string; error?: { message?: string } } | null;
    if (!response.ok || !body?.url || !body.id) throw new AppError(502, "stripe", body?.error?.message || "Stripe did not open checkout");
    await getPool().query("UPDATE payment_sessions SET provider_ref = $2 WHERE id = $1", [session.id, body.id]);
    return { redirectUrl: body.url, sessionId: session.id, gateway };
  }
  return startPhonePe(session.id, share);
}

async function startPhonePe(sessionId: string, share: { id: string; amount_paise: number }) {
  const merchantId = process.env.PHONEPE_MERCHANT_ID || "";
  const salt = process.env.PHONEPE_SALT || "";
  const index = process.env.PHONEPE_SALT_INDEX || "1";
  const base = process.env.PHONEPE_BASE_URL || "https://api-preprod.phonepe.com/apis/pg-sandbox";
  const payload = {
    merchantId,
    merchantTransactionId: sessionId.replace(/-/g, "").slice(0, 34),
    merchantUserId: "restro",
    amount: share.amount_paise,
    redirectUrl: `${appUrl()}/pay/return?gateway=phonepe&session=${sessionId}`,
    redirectMode: "REDIRECT",
    callbackUrl: `${appUrl()}/api/payments/phonepe/callback`,
    paymentInstrument: { type: "PAY_PAGE" },
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64");
  const checksum = crypto.createHash("sha256").update(`${encoded}/pg/v1/pay${salt}`).digest("hex") + `###${index}`;
  const response = await fetch(`${base}/pg/v1/pay`, {
    method: "POST",
    headers: { "content-type": "application/json", "X-VERIFY": checksum },
    body: JSON.stringify({ request: encoded }),
  });
  const body = (await response.json().catch(() => null)) as { success?: boolean; data?: { instrumentResponse?: { redirectInfo?: { url?: string } } }; message?: string } | null;
  const redirectUrl = body?.data?.instrumentResponse?.redirectInfo?.url;
  if (!response.ok || !redirectUrl) throw new AppError(502, "phonepe", body?.message || "PhonePe did not open a hosted page");
  await getPool().query("UPDATE payment_sessions SET provider_ref = $2 WHERE id = $1", [sessionId, payload.merchantTransactionId]);
  return { redirectUrl, sessionId, gateway: "phonepe" };
}

function cardBrand(digits: string) {
  if (digits.startsWith("4")) return "visa";
  if (digits.startsWith("5")) return "mastercard";
  return "card";
}

export async function chargeMock(sessionId: string, card: { number: string; expiry: string; name: string }) {
  const digits = card.number.replace(/\s+/g, "");
  const last4 = digits.slice(-4);
  let failure: string | null = null;
  if (!/^\d{16}$/.test(digits)) failure = "Enter the 16 digit sandbox number";
  else if (!/^\d{2}\/\d{2}$/.test(card.expiry)) failure = "Expiry should look like MM/YY";
  else if (digits === "4000000000000002") failure = "Card declined";
  else if (digits === "4000000000009995") failure = "Insufficient funds";
  else if (digits !== "4111111111111111" && digits !== "5555555555554444") failure = "This sandbox accepts 4111111111111111 or 5555555555554444";

  const outcome = await withTx(async (client) => {
    const session = await one<{ id: string; bill_share_id: string; order_id: string; status: string; amount_paise: number; gateway: string }>(
      client,
      "SELECT id, bill_share_id, order_id, status, amount_paise, gateway FROM payment_sessions WHERE id = $1 FOR UPDATE",
      [sessionId],
    );
    if (!session || session.gateway !== "mock") throw new AppError(404, "not_found", "Sandbox session not found");
    if (session.status === "PAID") return { orderId: session.order_id, already: true };
    if (failure) {
      await client.query("UPDATE payment_sessions SET status = 'FAILED' WHERE id = $1", [session.id]);
      await client.query(
        `INSERT INTO payments (order_id, bill_share_id, method, amount_paise, status, gateway, card_last4, card_brand, failure_reason)
         VALUES ($1,$2,'CARD',$3,'failed','mock',$4,$5,$6)`,
        [session.order_id, session.bill_share_id, session.amount_paise, last4, cardBrand(digits), failure],
      );
      return { orderId: session.order_id, already: false, failure };
    }
    await markSharePaid(client, session.bill_share_id, { method: "CARD", gateway: "mock", cardLast4: last4, cardBrand: cardBrand(digits), gatewayRef: session.id });
    await client.query("UPDATE payment_sessions SET status = 'PAID' WHERE id = $1", [session.id]);
    return { orderId: session.order_id, already: false, failure: null };
  });
  if (outcome.failure) throw new AppError(402, "declined", outcome.failure);
  emitFloor({ kind: "bill.updated", orderId: outcome.orderId });
  return presentOrder(getPool(), outcome.orderId);
}

export async function verifyRazorpay(sessionId: string, input: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) {
  const secret = process.env.RAZORPAY_KEY_SECRET || "";
  const expected = crypto.createHmac("sha256", secret).update(`${input.razorpay_order_id}|${input.razorpay_payment_id}`).digest("hex");
  const left = Buffer.from(expected);
  const right = Buffer.from(input.razorpay_signature);
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) throw new AppError(400, "signature", "Razorpay signature did not match");
  const outcome = await withTx(async (client) => {
    const session = await one<{ id: string; bill_share_id: string; order_id: string; status: string; provider_ref: string | null }>(
      client,
      "SELECT id, bill_share_id, order_id, status, provider_ref FROM payment_sessions WHERE id = $1 FOR UPDATE",
      [sessionId],
    );
    if (!session || session.provider_ref !== input.razorpay_order_id) throw new AppError(404, "not_found", "Razorpay session not found");
    if (session.status !== "PAID") {
      await markSharePaid(client, session.bill_share_id, { method: "CARD", gateway: "razorpay", gatewayRef: input.razorpay_payment_id });
      await client.query("UPDATE payment_sessions SET status = 'PAID' WHERE id = $1", [session.id]);
    }
    return session.order_id;
  });
  emitFloor({ kind: "bill.updated", orderId: outcome });
  return presentOrder(getPool(), outcome);
}

export async function confirmStripe(checkoutSessionId: string) {
  const response = await fetch(`https://api.stripe.com/v1/checkout/sessions/${checkoutSessionId}`, {
    headers: { authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` },
  });
  const body = (await response.json().catch(() => null)) as { id?: string; payment_status?: string; metadata?: { payment_session?: string }; error?: { message?: string } } | null;
  if (!response.ok || !body?.id) throw new AppError(502, "stripe", body?.error?.message || "Could not read the Stripe session");
  if (body.payment_status !== "paid") throw new AppError(402, "unpaid", "Stripe has not marked this payment as paid");
  const localId = body.metadata?.payment_session;
  if (!localId) throw new AppError(400, "stripe", "Stripe session is missing our payment reference");
  const outcome = await withTx(async (client) => {
    const session = await one<{ id: string; bill_share_id: string; order_id: string; status: string }>(client, "SELECT id, bill_share_id, order_id, status FROM payment_sessions WHERE id = $1 FOR UPDATE", [localId]);
    if (!session) throw new AppError(404, "not_found", "Payment session not found");
    if (session.status !== "PAID") {
      await markSharePaid(client, session.bill_share_id, { method: "CARD", gateway: "stripe", gatewayRef: body.id });
      await client.query("UPDATE payment_sessions SET status = 'PAID', provider_ref = $2 WHERE id = $1", [session.id, body.id]);
    }
    return session.order_id;
  });
  emitFloor({ kind: "bill.updated", orderId: outcome });
  return presentOrder(getPool(), outcome);
}

export async function upiQr(shareId: string) {
  const share = await openShare(shareId);
  const settings = await loadSettings(getPool());
  const amount = (share.amount_paise / 100).toFixed(2);
  const intent = `upi://pay?pa=${encodeURIComponent(settings.upiVpa)}&pn=${encodeURIComponent(settings.upiPayee)}&am=${amount}&cu=INR&tn=${encodeURIComponent(`Restro ${share.label}`)}`;
  const qr = await QRCode.toDataURL(intent, { margin: 1, width: 320, color: { dark: "#1a1208", light: "#fff8ef" } });
  return { intent, qr, vpa: settings.upiVpa, payee: settings.upiPayee, amount: rupees(share.amount_paise), shareId };
}

export async function confirmPhonePe(sessionId: string) {
  const session = await one<{ id: string; provider_ref: string | null; status: string; bill_share_id: string; order_id: string }>(
    getPool(),
    "SELECT id, provider_ref, status, bill_share_id, order_id FROM payment_sessions WHERE id = $1",
    [sessionId],
  );
  if (!session || !session.provider_ref) throw new AppError(404, "not_found", "PhonePe session not found");
  if (session.status === "PAID") return presentOrder(getPool(), session.order_id);
  const merchantId = process.env.PHONEPE_MERCHANT_ID || "";
  const salt = process.env.PHONEPE_SALT || "";
  const index = process.env.PHONEPE_SALT_INDEX || "1";
  const base = process.env.PHONEPE_BASE_URL || "https://api-preprod.phonepe.com/apis/pg-sandbox";
  const path = `/pg/v1/status/${merchantId}/${session.provider_ref}`;
  const checksum = crypto.createHash("sha256").update(`${path}${salt}`).digest("hex") + `###${index}`;
  const response = await fetch(`${base}${path}`, { headers: { "X-VERIFY": checksum, "X-MERCHANT-ID": merchantId } });
  const body = (await response.json().catch(() => null)) as { success?: boolean; code?: string; message?: string } | null;
  if (!response.ok || body?.code !== "PAYMENT_SUCCESS") {
    throw new AppError(402, "unpaid", body?.message || "PhonePe has not confirmed this payment");
  }
  const outcome = await withTx(async (client) => {
    const locked = await one<{ status: string; bill_share_id: string; order_id: string }>(client, "SELECT status, bill_share_id, order_id FROM payment_sessions WHERE id = $1 FOR UPDATE", [sessionId]);
    if (!locked) throw new AppError(404, "not_found", "PhonePe session not found");
    if (locked.status !== "PAID") {
      await markSharePaid(client, locked.bill_share_id, { method: "CARD", gateway: "phonepe", gatewayRef: session.provider_ref });
      await client.query("UPDATE payment_sessions SET status = 'PAID' WHERE id = $1", [sessionId]);
    }
    return locked.order_id;
  });
  emitFloor({ kind: "bill.updated", orderId: outcome });
  return presentOrder(getPool(), outcome);
}

export async function sessionPublic(sessionId: string) {
  const session = await one<{ id: string; amount_paise: number; gateway: string; status: string; provider_ref: string | null; order_id: string }>(
    getPool(),
    "SELECT id, amount_paise, gateway, status, provider_ref, order_id FROM payment_sessions WHERE id = $1",
    [sessionId],
  );
  if (!session) throw new AppError(404, "not_found", "Payment session not found");
  const settings = await loadSettings(getPool());
  return {
    id: session.id,
    amount: rupees(session.amount_paise),
    gateway: session.gateway,
    status: session.status,
    providerRef: session.provider_ref,
    orderId: session.order_id,
    restaurant: settings.restaurantName,
    keyId: session.gateway === "razorpay" ? process.env.RAZORPAY_KEY_ID || null : null,
  };
}

export async function sticker(orderId: string) {
  const settings = await loadSettings(getPool());
  const order = await presentOrder(getPool(), orderId);
  if (order.type !== "SWIGGY" && order.type !== "ZOMATO" && order.type !== "DELIVERY") {
    throw new AppError(400, "sticker", "Stickers are for parcel orders");
  }
  const code = order.deliveryId || order.orderId;
  const png = await bwipjs.toBuffer({ bcid: "code128", text: code, scale: 3, height: 12, includetext: true, textxalign: "center" });
  const qr = await QRCode.toDataURL(code, { margin: 1, width: 220 });
  return {
    restaurant: settings.restaurantName,
    address: settings.address,
    phone: settings.phone,
    fssai: settings.fssai,
    gstin: settings.gstin,
    partner: order.type,
    deliveryId: order.deliveryId,
    prepaid: order.paymentStatus === "PREPAID" || order.paymentStatus === "PAID",
    chefNote: order.chefNote,
    items: order.items.filter((item) => item.status !== "VOID"),
    subtotal: order.subtotal,
    cgst: order.cgst,
    sgst: order.sgst,
    parcel: order.parcel,
    total: order.total,
    barcode: `data:image/png;base64,${Buffer.from(png).toString("base64")}`,
    qr,
  };
}

export async function openDrawer(actor: Actor, floatRupees: number, meta: { ip: string; device: string }) {
  const existing = await one(getPool(), "SELECT id FROM drawer_shifts WHERE closed_at IS NULL");
  if (existing) throw new AppError(409, "drawer", "A drawer shift is already open");
  const row = await one<{ id: string }>(
    getPool(),
    "INSERT INTO drawer_shifts (opened_by, opening_float_paise) VALUES ($1,$2) RETURNING id",
    [actor.id, Math.round(floatRupees * 100)],
  );
  await audit(getPool(), { actorId: actor.id, actorEmail: actor.email, action: "drawer.open", entityId: row?.id, details: { float: floatRupees }, ip: meta.ip, device: meta.device });
  return drawerState();
}

export async function closeDrawer(actor: Actor, countedRupees: number, note: string | undefined, meta: { ip: string; device: string }) {
  const shift = await one<{ id: string; opening_float_paise: number; cash_sales_paise: number }>(getPool(), "SELECT id, opening_float_paise, cash_sales_paise FROM drawer_shifts WHERE closed_at IS NULL");
  if (!shift) throw new AppError(409, "drawer", "No drawer is open");
  const counted = Math.round(countedRupees * 100);
  const expected = shift.opening_float_paise + shift.cash_sales_paise;
  const variance = counted - expected;
  await getPool().query(
    "UPDATE drawer_shifts SET counted_paise=$2, expected_paise=$3, variance_paise=$4, note=$5, closed_at=now() WHERE id=$1",
    [shift.id, counted, expected, variance, note ?? null],
  );
  await audit(getPool(), { actorId: actor.id, actorEmail: actor.email, action: "drawer.close", entityId: shift.id, details: { expected: rupees(expected), counted: countedRupees, variance: rupees(variance) }, ip: meta.ip, device: meta.device });
  return drawerState();
}

export async function drawerState() {
  try {
    const open = await one<{ id: string; opening_float_paise: number; cash_sales_paise: number; opened_at: string }>(
      getPool(),
      "SELECT id, opening_float_paise, cash_sales_paise, opened_at FROM drawer_shifts WHERE closed_at IS NULL",
    );
    const recent = await getPool().query(
      "SELECT id, opening_float_paise, cash_sales_paise, expected_paise, counted_paise, variance_paise, opened_at, closed_at, note FROM drawer_shifts ORDER BY opened_at DESC LIMIT 8",
    );
    return {
      open: open
        ? { id: open.id, float: rupees(open.opening_float_paise), cashSales: rupees(open.cash_sales_paise), expected: rupees(open.opening_float_paise + open.cash_sales_paise), openedAt: open.opened_at }
        : null,
      recent: recent.rows.map((row) => ({
        id: row.id,
        float: rupees(row.opening_float_paise),
        cashSales: rupees(row.cash_sales_paise),
        expected: row.expected_paise == null ? null : rupees(row.expected_paise),
        counted: row.counted_paise == null ? null : rupees(row.counted_paise),
        variance: row.variance_paise == null ? null : rupees(row.variance_paise),
        openedAt: row.opened_at,
        closedAt: row.closed_at,
        note: row.note,
      })),
    };
  } catch {
    return { open: null, recent: [] };
  }
}

export async function analytics(from: string, to: string) {
  try {
    const payments = await getPool().query(
      `SELECT method, COALESCE(SUM(amount_paise),0)::int AS amount, count(*)::int AS n
       FROM payments WHERE status = 'success' AND created_at >= $1::date AND created_at < ($2::date + interval '1 day')
       GROUP BY method`,
      [from, to],
    );
    const top = await getPool().query(
      `SELECT oi.name, SUM(oi.qty)::int AS qty, SUM(oi.price_paise * oi.qty)::int AS amount
       FROM order_items oi JOIN orders o ON o.id = oi.order_id
       WHERE oi.status <> 'VOID' AND o.status <> 'CANCELLED' AND o.created_at >= $1::date AND o.created_at < ($2::date + interval '1 day')
       GROUP BY oi.name ORDER BY amount DESC LIMIT 8`,
      [from, to],
    );
    const open = await one<{ amount: number; n: number }>(getPool(), "SELECT COALESCE(SUM(total_paise),0)::int AS amount, count(*)::int AS n FROM bills WHERE status IN ('UNSETTLED','PARTIAL')");
    const voids = await one<{ n: number }>(getPool(), "SELECT count(*)::int AS n FROM audit_logs WHERE action = 'item.void' AND created_at >= $1::date AND created_at < ($2::date + interval '1 day')", [from, to]);
    return {
      from,
      to,
      payments: payments.rows.map((row) => ({ method: row.method, amount: rupees(row.amount), count: row.n })),
      sales: rupees(payments.rows.reduce((sum, row) => sum + Number(row.amount), 0)),
      topItems: top.rows.map((row) => ({ name: row.name, qty: row.qty, amount: rupees(row.amount) })),
      unsettled: { amount: rupees(open?.amount ?? 0), bills: open?.n ?? 0 },
      voids: voids?.n ?? 0,
    };
  } catch {
    return {
      from,
      to,
      payments: [],
      sales: 0,
      topItems: [],
      unsettled: { amount: 0, bills: 0 },
      voids: 0,
    };
  }
}
