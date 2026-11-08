import { getPool, isUniqueViolation, many, one, withTx, type Sql } from "./db";
import { AppError } from "./errors";
import { emitFloor } from "./io";
import { gstParts, inrToPaise, mulDivRound, rupees } from "./money";
import { loadSettings } from "./settings";
import { audit, type Actor } from "./auth";

type MenuRow = {
  id: number;
  name: string;
  menu_line: string | null;
  description: string | null;
  is_veg: boolean;
  base_price_paise: number | null;
  variant_kind: string | null;
  station: string;
  ui_group: string;
  is_available: boolean;
  section: string;
  category: string;
};

export type ItemInput = { menuItemId: number; variantId?: number; optionIds?: number[]; qty: number; note?: string };

function labelFor(item: { name: string; variant_kind: string | null }, variant: { name: string } | null, options: { name: string }[]) {
  const head = variant && item.variant_kind === "dish" ? variant.name : item.name;
  const parts = [head];
  if (variant && item.variant_kind !== "dish") parts.push(variant.name);
  for (const option of options) parts.push(option.name);
  return parts.join(" · ");
}

async function resolveLine(sql: Sql, input: ItemInput) {
  const item = await one<MenuRow & { variant_kind: string | null }>(
    sql,
    `SELECT i.*, c.section, c.name AS category
     FROM menu_items i JOIN menu_categories c ON c.id = i.category_id
     WHERE i.id = $1`,
    [input.menuItemId],
  );
  if (!item || !item.is_available) throw new AppError(400, "menu", "That dish is not available");
  const variants = await many<{ id: number; name: string; price_paise: number }>(sql, "SELECT id, name, price_paise FROM menu_variants WHERE item_id = $1 ORDER BY sort_order", [item.id]);
  let variant: { id: number; name: string; price_paise: number } | null = null;
  let price = item.base_price_paise;
  if (variants.length) {
    variant = variants.find((row) => row.id === input.variantId) ?? null;
    if (!variant) throw new AppError(400, "variant", `Choose a variant for ${item.name}`);
    price = variant.price_paise;
  }
  if (price == null) throw new AppError(400, "price", `${item.name} has no price`);
  const groups = await many<{ id: number; name: string; required: boolean }>(sql, "SELECT id, name, required FROM menu_option_groups WHERE item_id = $1 ORDER BY sort_order", [item.id]);
  const chosen = input.optionIds ?? [];
  const options: { group: string; name: string }[] = [];
  for (const group of groups) {
    const groupOptions = await many<{ id: number; name: string }>(sql, "SELECT id, name FROM menu_options WHERE group_id = $1", [group.id]);
    const pick = groupOptions.find((option) => chosen.includes(option.id));
    if (group.required && !pick) throw new AppError(400, "option", `Choose ${group.name} for ${item.name}`);
    if (pick) options.push({ group: group.name, name: pick.name });
  }
  return {
    menuItemId: item.id,
    name: labelFor(item, variant, options),
    variantName: variant?.name ?? null,
    options,
    pricePaise: price,
    station: item.station,
    isVeg: item.is_veg,
    note: input.note?.trim() || null,
    qty: input.qty,
  };
}

async function paidShareCount(sql: Sql, billId: string) {
  const row = await one<{ n: number }>(sql, "SELECT count(*)::int AS n FROM bill_shares WHERE bill_id = $1 AND status = 'PAID'", [billId]);
  return row?.n ?? 0;
}

export async function recalcBill(sql: Sql, orderId: string) {
  const order = await one<{ id: string; type: string; payment_status: string; parcel_paise: number | null }>(sql, "SELECT id, type, payment_status, parcel_paise FROM orders WHERE id = $1 FOR UPDATE", [orderId]);
  if (!order) throw new AppError(404, "not_found", "Order not found");
  const sub = await one<{ subtotal: number }>(sql, "SELECT COALESCE(SUM(price_paise * qty),0)::int AS subtotal FROM order_items WHERE order_id = $1 AND status <> 'VOID'", [orderId]);
  const settings = await loadSettings(sql);
  const existing = await one<{ id: string; discount_paise: number; discount_reason: string | null; bill_no: number }>(sql, "SELECT id, discount_paise, discount_reason, bill_no FROM bills WHERE order_id = $1 FOR UPDATE", [orderId]);
  let discount = existing?.discount_paise ?? 0;
  const subtotal = sub?.subtotal ?? 0;
  if (discount > subtotal) discount = subtotal;
  const taxable = subtotal - discount;
  const parts = gstParts(taxable, settings.gstRateBps);
  const parcel = order.parcel_paise ?? (order.type === "DINE_IN" ? 0 : settings.parcelChargePaise);
  const total = taxable + parts.cgst + parts.sgst + parcel;
  let billId = existing?.id;
  if (!existing) {
    const inserted = await one<{ id: string }>(
      sql,
      `INSERT INTO bills (order_id, status, subtotal_paise, discount_paise, taxable_paise, cgst_paise, sgst_paise, parcel_paise, total_paise, gst_rate_bps)
       VALUES ($1,'UNSETTLED',$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [orderId, subtotal, discount, taxable, parts.cgst, parts.sgst, parcel, total, settings.gstRateBps],
    );
    billId = inserted?.id;
  } else {
    await sql.query(
      `UPDATE bills SET subtotal_paise=$2, discount_paise=$3, taxable_paise=$4, cgst_paise=$5, sgst_paise=$6, parcel_paise=$7, total_paise=$8, gst_rate_bps=$9, updated_at=now()
       WHERE id=$1`,
      [existing.id, subtotal, discount, taxable, parts.cgst, parts.sgst, parcel, total, settings.gstRateBps],
    );
  }
  if (!billId) throw new AppError(500, "bill", "Could not save the bill");
  if (order.payment_status !== "PREPAID") {
    const paid = await paidShareCount(sql, billId);
    if (paid > 0) throw new AppError(409, "partial", "Payment has started, so this bill can no longer change");
    await sql.query("DELETE FROM bill_shares WHERE bill_id = $1", [billId]);
    await sql.query("INSERT INTO bill_shares (bill_id, label, amount_paise, status, sort_order) VALUES ($1,'Full bill',$2,'UNPAID',0)", [billId, total]);
    await sql.query("UPDATE orders SET total_amount = $2, payment_status = 'UNSETTLED' WHERE id = $1", [orderId, total]);
    await sql.query("UPDATE bills SET status = 'UNSETTLED' WHERE id = $1", [billId]);
  }
  return billId;
}

export async function presentOrder(sql: Sql, orderId: string) {
  const order = await one<{
    id: string; order_no: number; type: string; status: string; payment_status: string; table_no: number | null;
    delivery_id: string | null; chef_note: string | null; customer_name: string | null; address: string | null; total_amount: number;
  }>(sql, "SELECT id, order_no, type, status, payment_status, table_no, delivery_id, chef_note, customer_name, address, total_amount FROM orders WHERE id = $1", [orderId]);
  if (!order) throw new AppError(404, "not_found", "Order not found");
  const bill = await one<{
    id: string; bill_no: number; status: string; subtotal_paise: number; discount_paise: number; discount_reason: string | null;
    taxable_paise: number; cgst_paise: number; sgst_paise: number; parcel_paise: number; total_paise: number; gst_rate_bps: number;
  }>(sql, "SELECT * FROM bills WHERE order_id = $1", [orderId]);
  const items = await many<{ id: string; name: string; qty: number; price_paise: number; status: string; extra_note_to_chef: string | null; is_veg: boolean; station: string | null }>(
    sql,
    "SELECT id, name, qty, price_paise, status, extra_note_to_chef, is_veg, station FROM order_items WHERE order_id = $1 ORDER BY created_at",
    [orderId],
  );
  const shares = bill
    ? await many<{ id: string; label: string; amount_paise: number; status: string }>(sql, "SELECT id, label, amount_paise, status FROM bill_shares WHERE bill_id = $1 ORDER BY sort_order", [bill.id])
    : [];
  const payments = await many<{ id: string; method: string; amount_paise: number; status: string; gateway: string | null; card_last4: string | null; card_brand: string | null; tendered_paise: number | null; change_paise: number | null }>(
    sql,
    "SELECT id, method, amount_paise, status, gateway, card_last4, card_brand, tendered_paise, change_paise FROM payments WHERE order_id = $1 ORDER BY created_at",
    [orderId],
  );
  return {
    orderId: order.id,
    orderNo: order.order_no,
    type: order.type,
    status: order.status,
    paymentStatus: order.payment_status,
    tableNo: order.table_no,
    deliveryId: order.delivery_id,
    chefNote: order.chef_note,
    customerName: order.customer_name,
    address: order.address,
    billId: bill?.id ?? null,
    billNo: bill?.bill_no ?? null,
    billStatus: bill?.status ?? null,
    subtotal: rupees(bill?.subtotal_paise ?? 0),
    discount: rupees(bill?.discount_paise ?? 0),
    discountReason: bill?.discount_reason ?? null,
    taxable: rupees(bill?.taxable_paise ?? 0),
    cgst: rupees(bill?.cgst_paise ?? 0),
    sgst: rupees(bill?.sgst_paise ?? 0),
    parcel: rupees(bill?.parcel_paise ?? 0),
    total: rupees(bill?.total_paise ?? order.total_amount),
    gstRate: (bill?.gst_rate_bps ?? 500) / 100,
    items: items.map((item) => ({
      id: item.id,
      name: item.name,
      qty: item.qty,
      price: rupees(item.price_paise),
      amount: rupees(item.price_paise * item.qty),
      status: item.status,
      note: item.extra_note_to_chef,
      veg: item.is_veg,
      station: item.station,
    })),
    shares: shares.map((share) => ({ id: share.id, label: share.label, amount: rupees(share.amount_paise), status: share.status })),
    payments: payments.map((payment) => ({
      id: payment.id,
      method: payment.method,
      amount: rupees(payment.amount_paise),
      status: payment.status,
      gateway: payment.gateway,
      cardLast4: payment.card_last4,
      cardBrand: payment.card_brand,
      tendered: payment.tendered_paise == null ? null : rupees(payment.tendered_paise),
      change: payment.change_paise == null ? null : rupees(payment.change_paise),
    })),
  };
}

export async function placeDineIn(actor: Actor, input: { tableNo: number; guests?: number; chefNote?: string; items: ItemInput[] }, meta: { ip: string; device: string }) {
  const result = await withTx(async (client) => {
    const table = await one<{ table_no: number; status: string; current_order_id: string | null }>(client, "SELECT table_no, status, current_order_id FROM restaurant_tables WHERE table_no = $1 FOR UPDATE", [input.tableNo]);
    if (!table) throw new AppError(404, "table", "Tables are numbered 1 to 15");
    let orderId = table.current_order_id;
    if (orderId) {
      const open = await one<{ id: string; status: string; payment_status: string; chef_note: string | null }>(client, "SELECT id, status, payment_status, chef_note FROM orders WHERE id = $1 FOR UPDATE", [orderId]);
      if (!open || open.status !== "OPEN") orderId = null;
      else if (open.payment_status === "PARTIAL" || open.payment_status === "PAID") throw new AppError(409, "partial", "This table already has a payment. Finish it before adding dishes.");
      else if (input.chefNote) {
        const note = open.chef_note ? `${open.chef_note} · ${input.chefNote}` : input.chefNote;
        await client.query("UPDATE orders SET chef_note = $2 WHERE id = $1", [orderId, note]);
      }
    }
    if (!orderId) {
      const created = await one<{ id: string }>(
        client,
        `INSERT INTO orders (type, table_no, status, payment_status, chef_note, created_by) VALUES ('DINE_IN',$1,'OPEN','UNSETTLED',$2,$3) RETURNING id`,
        [input.tableNo, input.chefNote ?? null, actor.id],
      );
      orderId = created?.id ?? null;
    }
    if (!orderId) throw new AppError(500, "order", "Could not open the order");
    const kot = await one<{ id: string; kot_no: number }>(client, "INSERT INTO kots (order_id, created_by) VALUES ($1,$2) RETURNING id, kot_no", [orderId, actor.id]);
    if (!kot) throw new AppError(500, "kot", "Could not open the KOT");
    const lines = [];
    for (const item of input.items) {
      const line = await resolveLine(client, item);
      const inserted = await one<{ id: string }>(
        client,
        `INSERT INTO order_items (order_id, kot_id, menu_item_id, name, variant_name, options, qty, price_paise, status, extra_note_to_chef, station, is_veg)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,'QUEUED',$9,$10,$11) RETURNING id`,
        [orderId, kot.id, line.menuItemId, line.name, line.variantName, JSON.stringify(line.options), line.qty, line.pricePaise, line.note, line.station, line.isVeg],
      );
      lines.push({ ...line, id: inserted?.id });
    }
    await recalcBill(client, orderId);
    const nextStatus = table.status === "billing" ? "billing" : "occupied";
    await client.query("UPDATE restaurant_tables SET status = $2, current_order_id = $3, guest_count = COALESCE($4, guest_count), opened_at = COALESCE(opened_at, now()) WHERE table_no = $1", [input.tableNo, nextStatus, orderId, input.guests ?? null]);
    await audit(client, { actorId: actor.id, actorEmail: actor.email, action: "order.place", entityType: "order", entityId: orderId, details: { tableNo: input.tableNo, kotNo: kot.kot_no }, ip: meta.ip, device: meta.device });
    return { orderId, kotId: kot.id, kotNo: kot.kot_no, lines, tableStatus: nextStatus };
  });
  emitFloor({ kind: "kot.new", orderId: result.orderId, kotId: result.kotId, kotNo: result.kotNo, tableNo: input.tableNo, type: "DINE_IN" });
  emitFloor({ kind: "bill.updated", orderId: result.orderId, tableNo: input.tableNo });
  emitFloor({ kind: "table.updated", tableNo: input.tableNo, status: result.tableStatus });
  const bill = await presentOrder(getPool(), result.orderId);
  return { ...result, bill };
}

export async function requestBill(actor: Actor, orderId: string) {
  const order = await withTx(async (client) => {
    const row = await one<{ table_no: number | null }>(client, "SELECT table_no FROM orders WHERE id = $1 AND status = 'OPEN' FOR UPDATE", [orderId]);
    if (!row?.table_no) throw new AppError(404, "not_found", "There is no open dine-in order");
    await client.query("UPDATE restaurant_tables SET status = 'billing' WHERE table_no = $1", [row.table_no]);
    return row;
  });
  emitFloor({ kind: "table.updated", tableNo: order.table_no, status: "billing" });
  return { tableNo: order.table_no, status: "billing" };
}

export async function voidItem(actor: Actor, itemId: string, meta: { ip: string; device: string }) {
  const result = await withTx(async (client) => {
    const item = await one<{ id: string; order_id: string; name: string; status: string }>(client, "SELECT id, order_id, name, status FROM order_items WHERE id = $1 FOR UPDATE", [itemId]);
    if (!item) throw new AppError(404, "not_found", "Item not found");
    if (item.status === "VOID") {
      const existing = await one<{ table_no: number | null }>(client, "SELECT table_no FROM orders WHERE id = $1", [item.order_id]);
      return { ...item, table_no: existing?.table_no ?? null };
    }
    const order = await one<{ payment_status: string; table_no: number | null }>(client, "SELECT payment_status, table_no FROM orders WHERE id = $1 FOR UPDATE", [item.order_id]);
    if (!order || order.payment_status === "PAID" || order.payment_status === "PREPAID" || order.payment_status === "PARTIAL") {
      throw new AppError(409, "locked", "This item can no longer be voided");
    }
    await client.query("UPDATE order_items SET status = 'VOID' WHERE id = $1", [itemId]);
    await recalcBill(client, item.order_id);
    await audit(client, { actorId: actor.id, actorEmail: actor.email, action: "item.void", entityType: "order_item", entityId: itemId, details: { name: item.name }, ip: meta.ip, device: meta.device });
    return { ...item, table_no: order.table_no };
  });
  emitFloor({ kind: "bill.updated", orderId: result.order_id, tableNo: result.table_no });
  return presentOrder(getPool(), result.order_id);
}

export async function setItemStatus(actor: Actor, itemId: string, status: "PREPARING" | "READY") {
  const next = await withTx(async (client) => {
    const item = await one<{ id: string; status: string; name: string; order_id: string }>(client, "SELECT id, status, name, order_id FROM order_items WHERE id = $1 FOR UPDATE", [itemId]);
    if (!item || item.status === "VOID") throw new AppError(404, "not_found", "Kitchen item not found");
    if (item.status === status) {
      const order = await one<{ table_no: number | null; delivery_id: string | null; type: string }>(client, "SELECT table_no, delivery_id, type FROM orders WHERE id = $1", [item.order_id]);
      return { item, order };
    }
    const validTransitions: Record<string, string[]> = {
      QUEUED: ["PREPARING", "READY"],
      PREPARING: ["READY"],
      READY: ["PREPARING"],
    };
    if (!validTransitions[item.status]?.includes(status)) {
      throw new AppError(400, "status", `Cannot change dish status from ${item.status} to ${status}`);
    }
    await client.query("UPDATE order_items SET status = $2 WHERE id = $1", [itemId, status]);
    const order = await one<{ table_no: number | null; delivery_id: string | null; type: string }>(client, "SELECT table_no, delivery_id, type FROM orders WHERE id = $1", [item.order_id]);
    return { item, order };
  });
  emitFloor({
    kind: status === "READY" ? "item.ready" : "item.preparing",
    orderId: next.item.order_id,
    itemId,
    itemName: next.item.name,
    tableNo: next.order?.table_no ?? null,
    deliveryId: next.order?.delivery_id ?? null,
    type: next.order?.type,
    status,
  });
  return { id: itemId, status };
}

export async function kdsTickets(partner?: string) {
  try {
    const params: unknown[] = [];
    let filter = "";
    if (partner === "SWIGGY" || partner === "ZOMATO") {
      params.push(partner);
      filter = `AND o.type = $1`;
    }
    const rows = await many<{
      id: string; kot_no: number; created_at: string; order_id: string; type: string; table_no: number | null;
      delivery_id: string | null; chef_note: string | null; items: unknown;
    }>(
      getPool(),
      `SELECT k.id, k.kot_no, k.created_at, o.id AS order_id, o.type, o.table_no, o.delivery_id, o.chef_note,
              COALESCE(json_agg(json_build_object(
                'id', i.id, 'name', i.name, 'qty', i.qty, 'status', i.status,
                'note', i.extra_note_to_chef, 'station', i.station, 'veg', i.is_veg
              ) ORDER BY i.created_at) FILTER (WHERE i.status <> 'VOID'), '[]') AS items
       FROM kots k
       JOIN orders o ON o.id = k.order_id
       JOIN order_items i ON i.kot_id = k.id
       WHERE o.status = 'OPEN' ${filter}
       GROUP BY k.id, o.id
       HAVING count(*) FILTER (WHERE i.status <> 'VOID') > 0
       ORDER BY k.created_at`,
      params,
    );
    return rows.map((row) => ({
      id: row.id,
      kotNo: row.kot_no,
      createdAt: row.created_at,
      orderId: row.order_id,
      type: row.type,
      tableNo: row.table_no,
      deliveryId: row.delivery_id,
      parcel: row.type !== "DINE_IN",
      chefNote: row.chef_note,
      items: row.items,
    }));
  } catch {
    return [];
  }
}

export async function applyDiscount(actor: Actor, orderId: string, input: { mode: "percent" | "flat"; value: number; reason: string }, meta: { ip: string; device: string }) {
  await withTx(async (client) => {
    const order = await one<{ id: string }>(client, "SELECT id FROM orders WHERE id = $1 AND status = 'OPEN' FOR UPDATE", [orderId]);
    if (!order) throw new AppError(404, "not_found", "Order not found");
    await recalcBill(client, orderId);
    const bill = await one<{ id: string; subtotal_paise: number }>(client, "SELECT id, subtotal_paise FROM bills WHERE order_id = $1 FOR UPDATE", [orderId]);
    if (!bill) throw new AppError(404, "bill", "Bill not found");
    const settings = await loadSettings(client);
    const cap = mulDivRound(bill.subtotal_paise, Math.round(settings.maxDiscountPercent * 100), 10000);
    const discount = input.mode === "percent" ? mulDivRound(bill.subtotal_paise, Math.round(input.value * 100), 10000) : inrToPaise(input.value);
    if (discount > cap) throw new AppError(400, "discount", `Discount cannot exceed ${settings.maxDiscountPercent}% of the food total`);
    await client.query("UPDATE bills SET discount_paise = $2, discount_reason = $3 WHERE id = $1", [bill.id, discount, input.reason]);
    await recalcBill(client, orderId);
    await audit(client, { actorId: actor.id, actorEmail: actor.email, action: "bill.discount", entityType: "order", entityId: orderId, details: { mode: input.mode, value: input.value, reason: input.reason }, ip: meta.ip, device: meta.device });
  });
  const presented = await presentOrder(getPool(), orderId);
  emitFloor({ kind: "bill.updated", orderId, tableNo: presented.tableNo });
  return presented;
}

export async function splitBill(actor: Actor, orderId: string, parts: { label: string; amount: number }[], meta: { ip: string; device: string }) {
  await withTx(async (client) => {
    const bill = await one<{ id: string; total_paise: number; status: string }>(client, "SELECT b.id, b.total_paise, b.status FROM bills b WHERE b.order_id = $1 FOR UPDATE", [orderId]);
    if (!bill) throw new AppError(404, "not_found", "Bill not found");
    if (bill.status === "SETTLED") throw new AppError(409, "settled", "This bill is already settled");
    const paid = await paidShareCount(client, bill.id);
    if (paid > 0) throw new AppError(409, "partial", "A share is already paid");
    const amounts = parts.map((part) => inrToPaise(part.amount));
    const sum = amounts.reduce((total, amount) => total + amount, 0);
    if (sum !== bill.total_paise) throw new AppError(400, "split", "The shares have to add up to the bill total");
    await client.query("DELETE FROM bill_shares WHERE bill_id = $1", [bill.id]);
    for (let index = 0; index < parts.length; index += 1) {
      await client.query("INSERT INTO bill_shares (bill_id, label, amount_paise, status, sort_order) VALUES ($1,$2,$3,'UNPAID',$4)", [bill.id, parts[index].label, amounts[index], index]);
    }
    await audit(client, { actorId: actor.id, actorEmail: actor.email, action: "bill.split", entityType: "order", entityId: orderId, details: { parts }, ip: meta.ip, device: meta.device });
  });
  return presentOrder(getPool(), orderId);
}

export async function settleIfComplete(sql: Sql, orderId: string) {
  const bill = await one<{ id: string }>(sql, "SELECT id FROM bills WHERE order_id = $1", [orderId]);
  if (!bill) return;
  const shares = await many<{ status: string }>(sql, "SELECT status FROM bill_shares WHERE bill_id = $1", [bill.id]);
  if (!shares.length) return;
  if (shares.every((share) => share.status === "PAID")) {
    await sql.query("UPDATE bills SET status = 'SETTLED', paid_at = now() WHERE id = $1", [bill.id]);
    await sql.query("UPDATE orders SET payment_status = 'PAID', status = 'SETTLED', closed_at = now(), total_amount = (SELECT total_paise FROM bills WHERE id = $2) WHERE id = $1 AND type IN ('DINE_IN','DELIVERY')", [orderId, bill.id]);
    await sql.query("UPDATE restaurant_tables SET status = 'available', current_order_id = NULL, guest_count = NULL, opened_at = NULL WHERE current_order_id = $1", [orderId]);
    return;
  }
  if (shares.some((share) => share.status === "PAID")) {
    await sql.query("UPDATE bills SET status = 'PARTIAL' WHERE id = $1", [bill.id]);
    await sql.query("UPDATE orders SET payment_status = 'PARTIAL' WHERE id = $1", [orderId]);
  }
}

export async function markSharePaid(sql: Sql, shareId: string, payment: {
  method: "CASH" | "UPI" | "CARD" | "PLATFORM";
  gateway?: string | null;
  gatewayRef?: string | null;
  cardLast4?: string | null;
  cardBrand?: string | null;
  tenderedPaise?: number | null;
  changePaise?: number | null;
}) {
  const share = await one<{ id: string; amount_paise: number; status: string; bill_id: string }>(sql, "SELECT id, amount_paise, status, bill_id FROM bill_shares WHERE id = $1 FOR UPDATE", [shareId]);
  if (!share) throw new AppError(404, "not_found", "Bill share not found");
  const bill = await one<{ order_id: string }>(sql, "SELECT order_id FROM bills WHERE id = $1 FOR UPDATE", [share.bill_id]);
  if (share.status === "PAID") return { ...share, order_id: bill?.order_id ?? "" };
  if (!bill) throw new AppError(404, "bill", "Bill not found");
  await sql.query(
    `INSERT INTO payments (order_id, bill_share_id, method, amount_paise, tendered_paise, change_paise, status, gateway, gateway_ref, card_last4, card_brand)
     VALUES ($1,$2,$3,$4,$5,$6,'success',$7,$8,$9,$10)`,
    [bill.order_id, share.id, payment.method, share.amount_paise, payment.tenderedPaise ?? null, payment.changePaise ?? null, payment.gateway ?? null, payment.gatewayRef ?? null, payment.cardLast4 ?? null, payment.cardBrand ?? null],
  );
  await sql.query("UPDATE bill_shares SET status = 'PAID' WHERE id = $1", [share.id]);
  await settleIfComplete(sql, bill.order_id);
  return { ...share, order_id: bill.order_id };
}

export async function payCash(actor: Actor, shareId: string, tenderedRupees: number, meta: { ip: string; device: string }) {
  const outcome = await withTx(async (client) => {
    const drawer = await one<{ id: string }>(client, "SELECT id FROM drawer_shifts WHERE closed_at IS NULL FOR UPDATE");
    if (!drawer) throw new AppError(409, "drawer", "Open the cash drawer before taking cash");
    const share = await one<{ amount_paise: number; status: string }>(client, "SELECT amount_paise, status FROM bill_shares WHERE id = $1 FOR UPDATE", [shareId]);
    if (!share || share.status === "PAID") throw new AppError(409, "paid", "That share is already paid");
    const tendered = inrToPaise(tenderedRupees);
    if (tendered < share.amount_paise) throw new AppError(400, "tendered", "Cash tendered is less than the share");
    const change = tendered - share.amount_paise;
    const paid = await markSharePaid(client, shareId, { method: "CASH", gateway: "cash", tenderedPaise: tendered, changePaise: change });
    await client.query("UPDATE drawer_shifts SET cash_sales_paise = cash_sales_paise + $2 WHERE id = $1", [drawer.id, share.amount_paise]);
    await audit(client, { actorId: actor.id, actorEmail: actor.email, action: "payment.cash", entityType: "bill_share", entityId: shareId, details: { amount: rupees(share.amount_paise), change: rupees(change) }, ip: meta.ip, device: meta.device });
    return paid;
  });
  emitFloor({ kind: "bill.updated", orderId: outcome.order_id });
  return presentOrder(getPool(), outcome.order_id);
}

export async function confirmUpi(actor: Actor, shareId: string, meta: { ip: string; device: string }) {
  const outcome = await withTx(async (client) => {
    const settings = await loadSettings(client);
    const paid = await markSharePaid(client, shareId, { method: "UPI", gateway: "upi-qr", gatewayRef: settings.upiVpa });
    await audit(client, { actorId: actor.id, actorEmail: actor.email, action: "payment.upi", entityType: "bill_share", entityId: shareId, ip: meta.ip, device: meta.device });
    return paid;
  });
  emitFloor({ kind: "bill.updated", orderId: outcome.order_id });
  return presentOrder(getPool(), outcome.order_id);
}

export async function listTables() {
  try {
    return await many(getPool(), `
      SELECT t.table_no, t.status, t.guest_count, t.current_order_id, o.order_no, b.total_paise, b.status AS bill_status
      FROM restaurant_tables t
      LEFT JOIN orders o ON o.id = t.current_order_id
      LEFT JOIN bills b ON b.order_id = o.id
      ORDER BY t.table_no`);
  } catch {
    return Array.from({ length: 15 }, (_, i) => ({
      table_no: i + 1,
      status: "available",
      guest_count: null,
      current_order_id: null,
      order_no: null,
      total_paise: 0,
      bill_status: null,
    }));
  }
}

export async function publicMenu() {
  const settings = await loadSettings(getPool());
  const categories = await many<{ id: number; section: string; name: string; sort_order: number }>(getPool(), "SELECT id, section, name, sort_order FROM menu_categories ORDER BY sort_order");
  const items = await many<{
    id: number; category_id: number; name: string; menu_line: string | null; description: string | null; is_veg: boolean;
    base_price_paise: number | null; variant_kind: string | null; station: string; ui_group: string; is_available: boolean;
  }>(getPool(), "SELECT id, category_id, name, menu_line, description, is_veg, base_price_paise, variant_kind, station, ui_group, is_available FROM menu_items ORDER BY sort_order");
  const variants = await many<{ id: number; item_id: number; name: string; price_paise: number }>(getPool(), "SELECT id, item_id, name, price_paise FROM menu_variants ORDER BY sort_order");
  const groups = await many<{ id: number; item_id: number; name: string; required: boolean }>(getPool(), "SELECT id, item_id, name, required FROM menu_option_groups ORDER BY sort_order");
  const options = await many<{ id: number; group_id: number; name: string }>(getPool(), "SELECT id, group_id, name FROM menu_options ORDER BY sort_order");
  return {
    restaurant: { name: settings.restaurantName, address: settings.address, phone: settings.phone, hours: settings.hours },
    categories: categories.map((category) => ({
      id: category.id,
      section: category.section,
      name: category.name,
      items: items.filter((item) => item.category_id === category.id).map((item) => {
        const itemVariants = variants.filter((variant) => variant.item_id === item.id);
        const prices = itemVariants.length ? itemVariants.map((variant) => variant.price_paise) : [item.base_price_paise ?? 0];
        return {
          id: item.id,
          name: item.name,
          menuLine: item.menu_line,
          description: item.description,
          veg: item.is_veg,
          available: item.is_available,
          station: item.station,
          uiGroup: item.ui_group,
          variantKind: item.variant_kind,
          priceFrom: itemVariants.length > 1 && new Set(prices).size > 1,
          price: rupees(Math.min(...prices)),
          variants: itemVariants.map((variant) => ({ id: variant.id, name: variant.name, price: rupees(variant.price_paise) })),
          optionGroups: groups.filter((group) => group.item_id === item.id).map((group) => ({
            id: group.id,
            name: group.name,
            required: group.required,
            options: options.filter((option) => option.group_id === group.id).map((option) => ({ id: option.id, name: option.name })),
          })),
        };
      }),
    })),
  };
}

/**
 * Swiggy / Zomato intake.
 *
 * Signature: header `x-webhook-signature` is hex HMAC-SHA256 of the raw JSON body
 * using AGGREGATOR_WEBHOOK_SECRET. This is a placeholder for the partner's real
 * signing scheme — swap the canonical string when a live contract arrives.
 * If the secret is unset, development and test accept the body and record
 * signature_skipped. Production rejects it unless ALLOW_OPEN_WEBHOOKS=true.
 *
 * Idempotency: delivery_id is unique. A repeat delivery id returns the original
 * order instead of a second KOT. The unique index also closes the race between
 * two simultaneous webhooks.
 *
 * Prices: a menuItemId is priced from our menu. A free-text line must send its own price.
 */
export async function ingestAggregator(partner: "SWIGGY" | "ZOMATO", payload: {
  delivery_id: string;
  items: { menuItemId?: number; variantId?: number; optionIds?: number[]; name?: string; qty: number; price?: number; note?: string }[];
  customer_name?: string;
  chef_note?: string;
  parcel_charge?: number;
}, signature: { ok: boolean; skipped: boolean }, raw: unknown) {
  try {
    const created = await withTx(async (client) => {
      const existing = await one<{ order_id: string }>(client, "SELECT order_id FROM aggregator_orders WHERE delivery_id = $1", [payload.delivery_id]);
      if (existing) return { orderId: existing.order_id, idempotent: true };
      const settings = await loadSettings(client);
      const parcel = payload.parcel_charge == null ? settings.parcelChargePaise : inrToPaise(payload.parcel_charge);
      const order = await one<{ id: string }>(
        client,
        `INSERT INTO orders (type, delivery_id, status, payment_status, chef_note, customer_name, parcel_paise)
         VALUES ($1,$2,'OPEN','PREPAID',$3,$4,$5) RETURNING id`,
        [partner, payload.delivery_id, payload.chef_note ?? null, payload.customer_name ?? null, parcel],
      );
      if (!order) throw new AppError(500, "order", "Could not store the aggregator order");
      const kot = await one<{ id: string; kot_no: number }>(client, "INSERT INTO kots (order_id) VALUES ($1) RETURNING id, kot_no", [order.id]);
      for (const item of payload.items) {
        if (item.menuItemId) {
          const line = await resolveLine(client, { menuItemId: item.menuItemId, variantId: item.variantId, optionIds: item.optionIds, qty: item.qty, note: item.note });
          await client.query(
            `INSERT INTO order_items (order_id, kot_id, menu_item_id, name, variant_name, options, qty, price_paise, status, extra_note_to_chef, station, is_veg)
             VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,'QUEUED',$9,$10,$11)`,
            [order.id, kot?.id, line.menuItemId, line.name, line.variantName, JSON.stringify(line.options), line.qty, line.pricePaise, line.note, line.station, line.isVeg],
          );
        } else if (item.name && item.price != null) {
          await client.query(
            `INSERT INTO order_items (order_id, kot_id, name, options, qty, price_paise, status, extra_note_to_chef, station, is_veg)
             VALUES ($1,$2,$3,'[]'::jsonb,$4,$5,'QUEUED',$6,'parcel',true)`,
            [order.id, kot?.id, item.name, item.qty, inrToPaise(item.price), item.note ?? null],
          );
        } else {
          throw new AppError(400, "item", "Each aggregator item needs a menu id or a name and price");
        }
      }
      await client.query("UPDATE orders SET parcel_paise = $2 WHERE id = $1", [order.id, parcel]);
      const sub = await one<{ subtotal: number }>(client, "SELECT COALESCE(SUM(price_paise * qty),0)::int AS subtotal FROM order_items WHERE order_id = $1", [order.id]);
      const taxable = sub?.subtotal ?? 0;
      const tax = gstParts(taxable, settings.gstRateBps);
      const total = taxable + tax.cgst + tax.sgst + parcel;
      const bill = await one<{ id: string }>(
        client,
        `INSERT INTO bills (order_id, status, subtotal_paise, discount_paise, taxable_paise, cgst_paise, sgst_paise, parcel_paise, total_paise, gst_rate_bps, paid_at)
         VALUES ($1,'SETTLED',$2,0,$2,$3,$4,$5,$6,$7,now()) RETURNING id`,
        [order.id, taxable, tax.cgst, tax.sgst, parcel, total, settings.gstRateBps],
      );
      const share = await one<{ id: string }>(client, "INSERT INTO bill_shares (bill_id, label, amount_paise, status) VALUES ($1,$2,$3,'PAID') RETURNING id", [bill?.id, partner, total]);
      await client.query(
        `INSERT INTO payments (order_id, bill_share_id, method, amount_paise, status, gateway, gateway_ref) VALUES ($1,$2,'PLATFORM',$3,'success',$4,$5)`,
        [order.id, share?.id, total, partner.toLowerCase(), payload.delivery_id],
      );
      await client.query("UPDATE orders SET total_amount = $2 WHERE id = $1", [order.id, total]);
      await client.query(
        `INSERT INTO aggregator_orders (order_id, partner, delivery_id, signature_ok, signature_skipped, raw_payload)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
        [order.id, partner, payload.delivery_id, signature.ok, signature.skipped, JSON.stringify(raw)],
      );
      return { orderId: order.id, idempotent: false, kotNo: kot?.kot_no, total };
    });
    if (!created.idempotent) {
      emitFloor({ kind: "kot.new", orderId: created.orderId, type: partner, deliveryId: payload.delivery_id, parcel: true, kotNo: created.kotNo });
    }
    return created;
  } catch (error) {
    if (isUniqueViolation(error)) {
      const existing = await one<{ order_id: string }>(getPool(), "SELECT order_id FROM aggregator_orders WHERE delivery_id = $1", [payload.delivery_id]);
      if (existing) return { orderId: existing.order_id, idempotent: true };
    }
    throw error;
  }
}

export async function pickup(deliveryId: string, actor: Actor, meta: { ip: string; device: string }) {
  const order = await withTx(async (client) => {
    const row = await one<{ id: string; type: string; status: string }>(client, "SELECT id, type, status FROM orders WHERE delivery_id = $1 FOR UPDATE", [deliveryId]);
    if (!row || (row.type !== "SWIGGY" && row.type !== "ZOMATO")) throw new AppError(404, "not_found", "No parcel with that delivery id");
    if (row.status === "PICKED_UP") return row;
    const pending = await one<{ n: number }>(client, "SELECT count(*)::int AS n FROM order_items WHERE order_id = $1 AND status NOT IN ('READY','VOID')", [row.id]);
    if ((pending?.n ?? 0) > 0) throw new AppError(409, "kitchen", "Kitchen has not marked this parcel ready");
    await client.query("UPDATE orders SET status = 'PICKED_UP', picked_up_at = now() WHERE id = $1", [row.id]);
    await audit(client, { actorId: actor.id, actorEmail: actor.email, action: "parcel.pickup", entityType: "order", entityId: row.id, details: { deliveryId }, ip: meta.ip, device: meta.device });
    return row;
  });
  emitFloor({ kind: "parcel.picked", orderId: order.id, deliveryId });
  return presentOrder(getPool(), order.id);
}

export async function placeDelivery(customer: { id: string; name: string; mobile: string | null }, input: { address: string; chefNote?: string; items: ItemInput[] }) {
  if (!customer.mobile) throw new AppError(400, "mobile", "Add a mobile number before ordering delivery");
  const result = await withTx(async (client) => {
    const deliveryId = `DLV-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const order = await one<{ id: string }>(
      client,
      `INSERT INTO orders (type, delivery_id, status, payment_status, chef_note, address, customer_id, customer_name, customer_mobile)
       VALUES ('DELIVERY',$1,'OPEN','UNSETTLED',$2,$3,$4,$5,$6) RETURNING id`,
      [deliveryId, input.chefNote ?? null, input.address, customer.id, customer.name, customer.mobile],
    );
    if (!order) throw new AppError(500, "order", "Could not place the delivery");
    const kot = await one<{ id: string; kot_no: number }>(client, "INSERT INTO kots (order_id) VALUES ($1) RETURNING id, kot_no", [order.id]);
    for (const item of input.items) {
      const line = await resolveLine(client, item);
      await client.query(
        `INSERT INTO order_items (order_id, kot_id, menu_item_id, name, variant_name, options, qty, price_paise, status, extra_note_to_chef, station, is_veg)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,'QUEUED',$9,$10,$11)`,
        [order.id, kot?.id, line.menuItemId, line.name, line.variantName, JSON.stringify(line.options), line.qty, line.pricePaise, line.note, line.station, line.isVeg],
      );
    }
    await recalcBill(client, order.id);
    return { orderId: order.id, kotNo: kot?.kot_no, deliveryId };
  });
  emitFloor({ kind: "kot.new", orderId: result.orderId, type: "DELIVERY", deliveryId: result.deliveryId, parcel: true, kotNo: result.kotNo });
  return { ...result, bill: await presentOrder(getPool(), result.orderId) };
}
