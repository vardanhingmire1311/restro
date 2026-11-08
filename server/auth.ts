import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import type { Request, Response } from "express";
import { getPool, one, withTx } from "./db";
import { AppError } from "./errors";
import { kickUser } from "./io";

export type Actor = {
  id: string;
  role: "admin" | "waiter" | "chef" | "billing";
  email: string;
  name: string;
  jti: string;
  passwordIsDemo: boolean;
};

type JwtPayload = { sub: string; role: Actor["role"] | "customer"; jti: string; email?: string; typ?: string };

function secret() {
  const value = process.env.JWT_SECRET;
  if (process.env.NODE_ENV === "production" && !value) {
    throw new Error("JWT_SECRET is required in production");
  }
  return value || "dev-only-restro-secret-change-me";
}

export function deviceFromUa(ua: string | undefined) {
  const text = ua || "";
  const mobile = /Mobile|Android|iPhone|iPad/i.test(text);
  let os = "Unknown OS";
  if (/Windows/i.test(text)) os = "Windows";
  else if (/Android/i.test(text)) os = "Android";
  else if (/iPhone|iPad/i.test(text)) os = "iOS";
  else if (/Mac OS/i.test(text)) os = "macOS";
  else if (/Linux/i.test(text)) os = "Linux";
  let browser = "Browser";
  if (/Edg\//.test(text)) browser = "Edge";
  else if (/Chrome\//.test(text)) browser = "Chrome";
  else if (/Firefox\//.test(text)) browser = "Firefox";
  else if (/Safari\//.test(text)) browser = "Safari";
  return `${browser} on ${os} · ${mobile ? "phone" : "desktop"}`;
}

export function clientIp(req: Request) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) return forwarded.split(",")[0].trim();
  return req.socket.remoteAddress || "";
}

export function readCookie(req: Request, name: string) {
  const raw = req.headers.cookie || "";
  for (const part of raw.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith(`${name}=`)) return decodeURIComponent(trimmed.slice(name.length + 1));
  }
  return null;
}

export function bearer(req: Request, cookieName: string) {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) return header.slice(7).trim();
  return readCookie(req, cookieName);
}

export function setTokenCookie(res: Response, name: string, token: string, maxAge: number) {
  const secure = process.env.COOKIE_SECURE === "true" ? "; Secure" : "";
  res.append("Set-Cookie", `${name}=${encodeURIComponent(token)}; HttpOnly; Path=/; Max-Age=${maxAge}; SameSite=Lax${secure}`);
}

export function clearCookie(res: Response, name: string) {
  res.append("Set-Cookie", `${name}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`);
}

export async function audit(sql: { query: (text: string, params?: unknown[]) => Promise<unknown> }, entry: {
  actorId?: string | null;
  actorEmail?: string | null;
  action: string;
  entityType?: string;
  entityId?: string;
  details?: unknown;
  ip?: string;
  device?: string;
}) {
  await sql.query(
    `INSERT INTO audit_logs (actor_id, actor_email, action, entity_type, entity_id, details, ip, device)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8)`,
    [
      entry.actorId ?? null,
      entry.actorEmail ?? null,
      entry.action,
      entry.entityType ?? null,
      entry.entityId ?? null,
      JSON.stringify(entry.details ?? {}),
      entry.ip ?? null,
      entry.device ?? null,
    ],
  );
}

export async function loginStaff(input: { email: string; password: string }, meta: { ip: string; ua?: string }) {
  const email = input.email.toLowerCase();
  const device = deviceFromUa(meta.ua);
  const recent = await one<{ n: number }>(
    getPool(),
    `SELECT count(*)::int AS n FROM audit_logs
     WHERE action = 'login.failed' AND actor_email = $1 AND created_at > now() - interval '15 minutes'`,
    [email],
  );
  if ((recent?.n ?? 0) >= 8) {
    throw new AppError(429, "locked", "Too many failed sign-ins. Wait 15 minutes or ask an admin.");
  }
  const user = await one<{ id: string; name: string; email: string; role: Actor["role"]; password_hash: string; is_suspended: boolean; password_is_demo: boolean }>(
    getPool(),
    "SELECT id, name, email, role, password_hash, is_suspended, password_is_demo FROM users WHERE email = $1",
    [email],
  );
  const matches = user ? await bcrypt.compare(input.password, user.password_hash) : false;
  if (!user || !matches) {
    await audit(getPool(), { actorEmail: email, action: "login.failed", ip: meta.ip, device, details: { reason: "credentials" } });
    throw new AppError(401, "credentials", "Email or password is wrong");
  }
  if (user.is_suspended) {
    await audit(getPool(), { actorId: user.id, actorEmail: email, action: "login.failed", ip: meta.ip, device, details: { reason: "suspended" } });
    throw new AppError(403, "suspended", "This account is suspended");
  }
  const jti = crypto.randomUUID();
  const token = jwt.sign({ sub: user.id, role: user.role, jti, email: user.email }, secret(), { expiresIn: "12h" });
  const decoded = jwt.decode(token) as { exp: number };
  await withTx(async (client) => {
    await client.query(
      `INSERT INTO sessions (jti, user_id, ip, user_agent, device, expires_at) VALUES ($1,$2,$3,$4,$5, to_timestamp($6))`,
      [jti, user.id, meta.ip, meta.ua ?? "", device, decoded.exp],
    );
    await audit(client, { actorId: user.id, actorEmail: user.email, action: "login.ok", ip: meta.ip, device });
  });
  return {
    token,
    user: { id: user.id, name: user.name, email: user.email, role: user.role, passwordIsDemo: user.password_is_demo },
  };
}

export async function actorFromToken(token: string | null): Promise<Actor | null> {
  if (!token) return null;
  let payload: JwtPayload;
  try {
    payload = jwt.verify(token, secret()) as JwtPayload;
  } catch {
    return null;
  }
  if (!payload.jti || payload.typ === "guest" || payload.role === "customer") return null;
  const row = await one<{ id: string; name: string; email: string; role: Actor["role"]; is_suspended: boolean; password_is_demo: boolean; jti: string }>(
    getPool(),
    `UPDATE sessions s SET last_seen_at = now()
     FROM users u
     WHERE s.jti = $1 AND s.revoked_at IS NULL AND s.expires_at > now() AND u.id = s.user_id
     RETURNING u.id, u.name, u.email, u.role, u.is_suspended, u.password_is_demo, s.jti`,
    [payload.jti],
  );
  if (!row) return null;
  if (row.is_suspended) throw new AppError(403, "suspended", "This account is suspended");
  return { id: row.id, name: row.name, email: row.email, role: row.role, jti: row.jti, passwordIsDemo: row.password_is_demo };
}

export async function revokeSession(jti: string, reason: string, actor?: { id: string; email: string }, meta?: { ip: string; device: string }) {
  const row = await one<{ user_id: string }>(getPool(), "UPDATE sessions SET revoked_at = now(), revoke_reason = $2 WHERE jti = $1 AND revoked_at IS NULL RETURNING user_id", [jti, reason]);
  if (!row) return;
  await audit(getPool(), { actorId: actor?.id, actorEmail: actor?.email, action: "session.revoke", entityType: "session", entityId: jti, details: { reason, userId: row.user_id }, ip: meta?.ip, device: meta?.device });
  kickUser(row.user_id);
}

export async function suspendUser(userId: string, suspended: boolean, actor: Actor, meta: { ip: string; device: string }) {
  if (userId === actor.id && suspended) throw new AppError(400, "self", "You cannot suspend your own login");
  await withTx(async (client) => {
    const user = await one<{ id: string; email: string }>(client, "SELECT id, email FROM users WHERE id = $1 FOR UPDATE", [userId]);
    if (!user) throw new AppError(404, "not_found", "Staff member not found");
    await client.query("UPDATE users SET is_suspended = $2, updated_at = now() WHERE id = $1", [userId, suspended]);
    if (suspended) {
      await client.query("UPDATE sessions SET revoked_at = now(), revoke_reason = 'suspended' WHERE user_id = $1 AND revoked_at IS NULL", [userId]);
    }
    await audit(client, {
      actorId: actor.id,
      actorEmail: actor.email,
      action: suspended ? "staff.suspend" : "staff.activate",
      entityType: "user",
      entityId: userId,
      ip: meta.ip,
      device: meta.device,
    });
  });
  if (suspended) kickUser(userId);
}

export function signCustomer(customer: { id: string; name: string; mobile: string | null }) {
  const jti = crypto.randomUUID();
  const token = jwt.sign({ sub: customer.id, role: "customer", typ: "guest", jti }, secret(), { expiresIn: "30d" });
  const decoded = jwt.decode(token) as { exp: number };
  return { token, jti, exp: decoded.exp };
}

export async function customerFromToken(token: string | null) {
  if (!token) return null;
  let payload: JwtPayload;
  try {
    payload = jwt.verify(token, secret()) as JwtPayload;
  } catch {
    return null;
  }
  if (payload.typ !== "guest") return null;
  const row = await one<{ id: string; name: string; mobile: string | null; email: string | null }>(
    getPool(),
    `UPDATE sessions s SET last_seen_at = now()
     FROM customers c
     WHERE s.jti = $1 AND s.revoked_at IS NULL AND s.expires_at > now() AND c.id = s.customer_id
     RETURNING c.id, c.name, c.mobile, c.email`,
    [payload.jti],
  );
  return row;
}

export async function assertAdminPin(pin: string) {
  const row = await one<{ value: string }>(getPool(), "SELECT value FROM settings WHERE key = 'admin_pin_hash'");
  const hash = typeof row?.value === "string" ? row.value : "";
  if (!hash || !(await bcrypt.compare(pin, hash))) throw new AppError(403, "pin", "Admin PIN is wrong");
}

export { bcrypt, secret as jwtSecret };
