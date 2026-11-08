export type Role = "admin" | "waiter" | "chef" | "billing";

export type StaffUser = { id: string; name: string; email: string; role: Role; passwordIsDemo?: boolean };

export type OptionGroup = { id: number; name: string; required: boolean; options: { id: number; name: string }[] };
export type Variant = { id: number; name: string; price: number };
export type Dish = {
  id: number;
  name: string;
  menuLine: string | null;
  description: string | null;
  veg: boolean;
  available: boolean;
  station: string;
  uiGroup: string;
  price: number;
  priceFrom: boolean;
  variants: Variant[];
  optionGroups: OptionGroup[];
};
export type MenuCategory = { id: number; section: string; name: string; items: Dish[] };
export type MenuPayload = { restaurant: { name: string; address: string; phone: string; hours: string }; categories: MenuCategory[] };

export type CartLine = { key: string; menuItemId: number; name: string; variantId?: number; optionIds: number[]; qty: number; note: string; price: number };

export type BillItem = { id: string; name: string; qty: number; price: number; amount: number; status: string; note: string | null; veg: boolean };
export type Share = { id: string; label: string; amount: number; status: string };
export type Bill = {
  orderId: string;
  orderNo: number;
  type: string;
  status: string;
  paymentStatus: string;
  tableNo: number | null;
  deliveryId: string | null;
  chefNote: string | null;
  billNo: number | null;
  subtotal: number;
  discount: number;
  taxable: number;
  cgst: number;
  sgst: number;
  parcel: number;
  total: number;
  items: BillItem[];
  shares: Share[];
};

export type TableTile = { tableNo: number; status: string; guests: number | null; orderId: string | null; orderNo: number | null; total: number; billStatus: string | null };

export type Ticket = {
  id: string;
  kotNo: number;
  createdAt: string;
  orderId: string;
  type: string;
  tableNo: number | null;
  deliveryId: string | null;
  parcel: boolean;
  chefNote: string | null;
  items: { id: string; name: string; qty: number; status: string; note: string | null; station: string; veg: boolean }[];
};
