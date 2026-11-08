export class ApiError extends Error {
  status: number;
  fields?: Record<string, string>;
  constructor(message: string, status: number, fields?: Record<string, string>) {
    super(message);
    this.status = status;
    this.fields = fields;
  }
}

export function apiBase() {
  return process.env.NEXT_PUBLIC_API_URL || "";
}

export async function api<T>(path: string, init: RequestInit & { token?: string | null } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  if (init.token) headers.set("authorization", `Bearer ${init.token}`);
  const response = await fetch(`${apiBase()}${path}`, { ...init, headers, cache: "no-store" });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.ok) {
    throw new ApiError(body?.error?.message || "Request failed", response.status, body?.error?.fields);
  }
  return body.data as T;
}

export function inr(value: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(value || 0);
}
