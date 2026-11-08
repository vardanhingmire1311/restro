-- Restro schema. Money is integer paise. Spec names (orders, order_items, payments,
-- aggregator_orders, sessions, audit_logs, bookings, customers, tables, menu_items, roles)
-- are the tables below; variants/options, bills, and KOTs are the normalized pieces
-- those records need.

CREATE TABLE roles (
  name text PRIMARY KEY,
  description text NOT NULL
);

INSERT INTO roles (name, description) VALUES
  ('admin', 'Menu, staff, security, analytics'),
  ('waiter', 'Tables and orders. No settlement. Voids need the admin PIN'),
  ('chef', 'Kitchen display only. No prices'),
  ('billing', 'Bills, splits, payments, drawer. No menu edits');

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role text NOT NULL REFERENCES roles(name),
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  is_suspended boolean NOT NULL DEFAULT false,
  password_is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  mobile text UNIQUE,
  email text,
  google_sub text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  jti uuid NOT NULL UNIQUE,
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  customer_id uuid REFERENCES customers(id) ON DELETE CASCADE,
  ip text,
  user_agent text,
  device text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoke_reason text,
  CHECK (num_nonnulls(user_id, customer_id) = 1)
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

CREATE TABLE audit_logs (
  id bigserial PRIMARY KEY,
  actor_id uuid,
  actor_email text,
  action text NOT NULL,
  entity_type text,
  entity_id text,
  details jsonb,
  ip text,
  device text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_time_idx ON audit_logs (created_at DESC);

CREATE TABLE settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE menu_categories (
  id serial PRIMARY KEY,
  section text NOT NULL,
  name text NOT NULL,
  sort_order int NOT NULL,
  UNIQUE (section, name)
);

CREATE TABLE menu_items (
  id serial PRIMARY KEY,
  category_id int NOT NULL REFERENCES menu_categories(id),
  name text NOT NULL,
  menu_line text,
  description text,
  is_veg boolean NOT NULL,
  base_price_paise int,
  variant_kind text,
  station text NOT NULL,
  ui_group text NOT NULL,
  is_available boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL,
  source text NOT NULL DEFAULT 'owner_full_menu',
  editable boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE menu_variants (
  id serial PRIMARY KEY,
  item_id int NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  name text NOT NULL,
  price_paise int NOT NULL,
  sort_order int NOT NULL
);

CREATE TABLE menu_option_groups (
  id serial PRIMARY KEY,
  item_id int NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  name text NOT NULL,
  required boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL
);

CREATE TABLE menu_options (
  id serial PRIMARY KEY,
  group_id int NOT NULL REFERENCES menu_option_groups(id) ON DELETE CASCADE,
  name text NOT NULL,
  sort_order int NOT NULL
);

CREATE TABLE restaurant_tables (
  table_no int PRIMARY KEY CHECK (table_no BETWEEN 1 AND 15),
  status text NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'occupied', 'billing')),
  current_order_id uuid,
  guest_count int,
  opened_at timestamptz
);

CREATE SEQUENCE order_no_seq START 1001;
CREATE SEQUENCE kot_no_seq START 100;
CREATE SEQUENCE bill_no_seq START 5001;

CREATE TABLE orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_no int NOT NULL UNIQUE DEFAULT nextval('order_no_seq'),
  type text NOT NULL CHECK (type IN ('DINE_IN', 'SWIGGY', 'ZOMATO', 'DELIVERY')),
  table_no int REFERENCES restaurant_tables(table_no),
  delivery_id text UNIQUE,
  status text NOT NULL CHECK (status IN ('OPEN', 'SETTLED', 'CANCELLED', 'PICKED_UP')),
  payment_status text NOT NULL CHECK (payment_status IN ('UNSETTLED', 'PARTIAL', 'PAID', 'PREPAID')),
  chef_note text,
  address text,
  customer_id uuid REFERENCES customers(id),
  customer_name text,
  customer_mobile text,
  total_amount int NOT NULL DEFAULT 0,
  parcel_paise int,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  picked_up_at timestamptz
);
CREATE INDEX orders_table_open_idx ON orders (table_no) WHERE status = 'OPEN';

CREATE TABLE kots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kot_no int NOT NULL UNIQUE DEFAULT nextval('kot_no_seq'),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  kot_id uuid REFERENCES kots(id),
  menu_item_id int REFERENCES menu_items(id),
  name text NOT NULL,
  variant_name text,
  options jsonb NOT NULL DEFAULT '[]',
  qty int NOT NULL CHECK (qty BETWEEN 1 AND 50),
  price_paise int NOT NULL CHECK (price_paise >= 0),
  status text NOT NULL CHECK (status IN ('QUEUED', 'PREPARING', 'READY', 'VOID')),
  extra_note_to_chef text,
  station text,
  is_veg boolean,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE bills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_no int NOT NULL UNIQUE DEFAULT nextval('bill_no_seq'),
  order_id uuid NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('UNSETTLED', 'PARTIAL', 'SETTLED')),
  subtotal_paise int NOT NULL,
  discount_paise int NOT NULL DEFAULT 0,
  discount_reason text,
  taxable_paise int NOT NULL,
  cgst_paise int NOT NULL,
  sgst_paise int NOT NULL,
  parcel_paise int NOT NULL DEFAULT 0,
  total_paise int NOT NULL,
  gst_rate_bps int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz
);

CREATE TABLE bill_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id uuid NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  label text NOT NULL,
  amount_paise int NOT NULL CHECK (amount_paise >= 0),
  status text NOT NULL CHECK (status IN ('UNPAID', 'PAID')),
  sort_order int NOT NULL DEFAULT 0
);

CREATE TABLE payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id),
  bill_share_id uuid REFERENCES bill_shares(id),
  method text NOT NULL CHECK (method IN ('CASH', 'UPI', 'CARD', 'PLATFORM')),
  amount_paise int NOT NULL,
  tendered_paise int,
  change_paise int,
  status text NOT NULL CHECK (status IN ('pending', 'success', 'failed')),
  gateway text,
  gateway_ref text,
  card_last4 text,
  card_brand text,
  failure_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE payment_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_share_id uuid NOT NULL REFERENCES bill_shares(id),
  order_id uuid NOT NULL REFERENCES orders(id),
  gateway text NOT NULL,
  amount_paise int NOT NULL,
  status text NOT NULL CHECK (status IN ('PENDING', 'PAID', 'FAILED')),
  provider_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE TABLE aggregator_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
  partner text NOT NULL CHECK (partner IN ('SWIGGY', 'ZOMATO')),
  delivery_id text NOT NULL UNIQUE,
  signature_ok boolean NOT NULL,
  signature_skipped boolean NOT NULL,
  raw_payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customers(id),
  guest_name text NOT NULL,
  mobile text NOT NULL,
  party_size int NOT NULL CHECK (party_size BETWEEN 1 AND 12),
  booking_date date NOT NULL,
  booking_time time NOT NULL,
  notes text,
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'confirmed', 'cancelled', 'seated')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE otp_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mobile text NOT NULL,
  name text NOT NULL,
  code_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  attempts int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE drawer_shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opened_by uuid NOT NULL REFERENCES users(id),
  opening_float_paise int NOT NULL,
  cash_sales_paise int NOT NULL DEFAULT 0,
  expected_paise int,
  counted_paise int,
  variance_paise int,
  note text,
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);

CREATE TABLE google_states (
  state text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);
