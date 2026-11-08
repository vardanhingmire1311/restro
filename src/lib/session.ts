import type { StaffUser } from "./types";

const STAFF = "restro_staff";
const GUEST = "restro_guest";

export function saveStaff(token: string, user: StaffUser) {
  localStorage.setItem(STAFF, JSON.stringify({ token, user }));
}

export function staffSession(): { token: string; user: StaffUser } | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(STAFF);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as { token: string; user: StaffUser };
  } catch {
    return null;
  }
}

export function clearStaff() {
  localStorage.removeItem(STAFF);
}

export function saveGuest(token: string, customer: { id: string; name: string; mobile: string | null }) {
  localStorage.setItem(GUEST, JSON.stringify({ token, customer }));
}

export function guestSession(): { token: string; customer: { id: string; name: string; mobile: string | null } } | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(GUEST);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as { token: string; customer: { id: string; name: string; mobile: string | null } };
  } catch {
    return null;
  }
}

export function clearGuest() {
  localStorage.removeItem(GUEST);
}

export function homeFor(role: StaffUser["role"]) {
  if (role === "admin") return "/admin";
  if (role === "chef") return "/kitchen";
  if (role === "billing") return "/billing";
  return "/waiter";
}
