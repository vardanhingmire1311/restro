# Restro

Service floor, kitchen pass, and billing for a 15-table multi-cuisine dining room. The menu is the owner's 10-page card, stored as seed data in [`menu/menu.json`](menu/menu.json). Nothing on that card was invented, and dishes that are not on it are not in the database.

The interface is a dark dining room: background `#0f0f11`, saffron `#FF9933`, glass panels with a 12px blur. Staff apps update live over Socket.io.

## What you can do

- **Guest site** (`/`) browses the full menu and builds a basket with no account. Sign-in is required only to request a table or place a home-delivery order. Sign-in is a name plus a 10-digit mobile, with a one-time code. Google Sign-In appears only after OAuth keys are set.
- **Waiter** (`/waiter`) is a thumb-friendly view of tables 1–15. Green is free, amber is occupied, red means the bill was requested. Sending a ticket creates or updates one unsettled bill for that table and pushes one kitchen ticket.
- **Kitchen** (`/kitchen`) is a kanban: New, Cooking, Ready. Each ticket has a 15-minute timer that shifts from white toward red. Notes to the chef are red on a dark red ground. Swiggy and Zomato tickets are tagged PARCEL. The kitchen payload has no prices.
- **Billing** (`/billing`) settles the running bill, applies a discount inside the configured cap (15% unless an admin changes it), splits a bill into shares (two cards is the default split), and takes cash, a UPI QR, or a card. Cash requires an open drawer and a counted close. Swiggy and Zomato have their own tabs.
- **Admin** (`/admin`) edits prices and 86s dishes, suspends a person (which revokes their sessions immediately), revokes one session, reads the audit log, confirms bookings, and sets GSTIN, FSSAI, the UPI VPA, and the admin PIN.

Waiters cannot settle a bill. Voiding a dish requires the admin PIN, unless the person signed in is an admin. Chefs cannot open bills. Billing cannot edit the menu.

## Menu seed

[`menu/menu.source.md`](menu/menu.source.md) is the transcription of the owner's photos. [`scripts/compile-menu.mjs`](scripts/compile-menu.mjs) turns it into [`menu/menu.json`](menu/menu.json), which is the only menu the database loads.

```bash
npm run menu:compile
```

Rules, also written at the top of the compiler:

- A printed `a/b` price is a variant. Tandoori Chicken is Full ₹520 or Half ₹275.
- `Choice of …` is one item plus a required option group. Choice of Paneer at ₹275 includes Butter Masala, Kadhai, Palak, and the rest of the printed list. Those are not separate dishes.
- Pasta asks for a shape (Spaghetti, Penne, Farfale, Macroni, Fettucini, Fussili) and a sauce (Creamy Cheese, Arrabbita, Pesto, Mix). The price does not change.
- A slash in the dish name at one price is a set of variants. Where the card shares a leading or trailing word (`Cream of Tomato / Veg.`, `Malai / Matka Kulfi`), that word is repeated so the ticket names a dish. The original printed line is kept on `menuLine`.
- Spellings are as printed: Cupsium, Tripple, Sez, Hydrabadi, Bruchetta, Chattinad, and the rest.

Re-seeding does not wipe a menu that is already loaded, and it does not reset a password that was changed.

The Indian card is grouped in the UI as Starters, Tandoori, Main Course, Breads, and Rice & Biryani. Chinese, Italian, Continental, Sandwiches, Bakery, Desserts, and Beverages stay as their own sections. Tandoori is a view of starters whose printed name is tandoori, tikka, kabab, or tangdi. It does not add dishes.

## Architecture

One Node process serves both sides:

- [Express 4](server/app.ts) for HTTP, Zod on every body, and a single error handler. Users see a message, not a stack.
- [Socket.io](server/index.ts) on the same port. A JWT is checked on connect. Suspend or revoke emits `session:revoked` and drops the socket.
- Next.js for the pages. In development this is the Next dev server mounted on the Express app. In production, `next build` then the same custom server.
- PostgreSQL. Money is integer paise. GST is 5% by default (CGST and SGST each take half of the rounded tax, so the two taxes add up to the headline rate). Mutations run in a transaction and roll back on failure.
- Staff auth is a JWT (`Authorization: Bearer` and an httpOnly cookie) plus a `sessions` row. Checking the row is what makes revoke instant. A stolen token stops working when the session is revoked or the person is suspended. Tokens last 12 hours.
- Failed sign-ins are written to `audit_logs` with IP and a short device string parsed from the user agent. Eight failures for the same email inside 15 minutes lock that email.

The realtime bus is in memory. One Render instance is the deployment this repo is built for. Several instances would each have their own Socket.io room, and a ticket fired on one would not light up the others. There is no Redis adapter in this build.

`upipay` on npm is a real package (v1.0.0, published 3 June 2026, one release, one maintainer). It is not used. A single release with no dependents is not something this desk should depend on for taking money, and the package still needs the restaurant's own PhonePe or Paytm merchant account. UPI here is the NPCI `upi://pay` link rendered with the `qrcode` package. The cashier confirms the credit by hand, because a QR code cannot see the bank.

Paytm Business is a named adapter that returns a clear "not enabled" error. PhonePe sandbox checkout is implemented with their published SHA-256 salt checksum and runs only when `PHONEPE_MERCHANT_ID` and `PHONEPE_SALT` are set. It does not pretend a missing key is a successful payment.

## Run it locally

Node.js 22 and PostgreSQL 16 are enough. Docker is optional.

### Linux or macOS, Postgres already installed

Create the role if you do not have it (`postgres` / `postgres`), then:

```bash
npm install
npm run dev
```

`scripts/dev.mjs` creates `restro_db` when the server is reachable but the database is missing, runs migrations, loads the seed, and listens on [http://127.0.0.1:3847](http://127.0.0.1:3847).

`scripts/start.sh` is the same command and installs dependencies first if `node_modules` is absent.

### Windows, without Docker

1. Install Node.js 22 and PostgreSQL from the official installers.
2. In the PostgreSQL installer, set the superuser password to `postgres`.
3. In PowerShell, from this folder:

```powershell
npm install
npm run dev
```

Or `.\scripts\start.ps1`, which installs dependencies if needed and then runs `npm run dev`.

If Postgres is on another port or password, set `DATABASE_URL` before launching. The default is `postgresql://postgres:postgres@localhost:5432/restro_db`.

### Docker

```bash
docker compose up --build
```

That starts Postgres and the production server on port 3847. The database volume is `restro_pg`.

Production without Docker, after Postgres is up:

```bash
npm install
npm run build
npm start
```

`npm start` refuses to boot in production without `JWT_SECRET`.

## Environment

Copy `.env.example` to `.env`. The process reads it through `dotenv`.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres connection string. `sslmode=require` is stripped and TLS is enabled for hosts such as Neon. |
| `JWT_SECRET` | Signs staff and guest tokens. Required when `NODE_ENV=production`. |
| `APP_URL` | Public origin, used for OAuth redirects and payment return URLs. |
| `PORT` | Listen port. Render sets this. Local default is 3847. |
| `TZ` | Defaults to `Asia/Kolkata`, including the Postgres session time zone, so "today" on the desk matches the dining room. |
| `NEXT_PUBLIC_API_URL` | Leave empty when the UI and API share a port. Set to the Render URL if the UI is hosted elsewhere. |
| `NEXT_PUBLIC_SOCKET_URL` | Same idea for Socket.io. |
| `CLIENT_ORIGIN` | Comma-separated browser origins allowed by CORS when the UI is on another host. |
| `COOKIE_SECURE` | Set `true` only behind HTTPS. |
| `OTP_DEV_REVEAL` | When `true` and not production, the OTP response includes `devCode`. The code is always printed in the server log if no SMS provider is configured. |
| `FAST2SMS_API_KEY` | Sends the OTP through Fast2SMS route `otp`. |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` | Used when Fast2SMS is unset. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Both are required. Redirect URI is `{APP_URL}/api/customer/google/callback`. |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | Test-mode order creation and signature check. |
| `STRIPE_SECRET_KEY` | Test-mode Checkout Session. |
| `PHONEPE_MERCHANT_ID`, `PHONEPE_SALT`, `PHONEPE_SALT_INDEX` | PhonePe PG sandbox. |
| `AGGREGATOR_WEBHOOK_SECRET` | HMAC secret for `x-webhook-signature`. In production the webhooks reject calls when this is empty, unless `ALLOW_OPEN_WEBHOOKS=true`. |
| `PGSSL_REJECT_UNAUTHORIZED` | Set `true` to verify the database certificate. Default for `sslmode=require` is off, which is what Neon’s Node examples usually need. |

UPI VPA, payee name, GSTIN, FSSAI, GST rate, parcel charge, discount cap, and the admin PIN live in the `settings` table and are edited on the admin desk. The env file does not override them after the first seed.

## Demo logins

Change these before the app is reachable outside the restaurant. The desk shows a banner while `password_is_demo` is still set. Changing the password clears it.

| Role | Email | Password |
| --- | --- | --- |
| Admin | admin@restro.com | admin123 |
| Waiter | waiter@restro.com | waiter123 |
| Chef | chef@restro.com | chef123 |
| Billing | billing@restro.com | billing123 |

Admin PIN for voids: **2580**. Change it under Desk → Settings. The demo PIN flag clears when you do.

## How a service runs

1. Waiter opens a table and adds dishes. Variants and options are required when the card says so. Each dish can carry a note, and the order can carry one note for the whole ticket.
2. Send KOT. The server writes the lines as `QUEUED`, opens a KOT, recalculates the unsettled bill (food, discount, CGST, SGST, parcel charge for delivery and aggregators), and emits `kot.new`. The table turns amber.
3. Chef moves each line `QUEUED → PREPARING → READY`. The waiter gets a toast when a line is ready. Skipping a step is rejected.
4. Waiter taps Request bill. The table turns red. Billing already had the running total from step 2.
5. Billing discounts, optionally splits, and pays every share. The table returns to green only when every share is paid. A partial payment locks the bill: no more voids, discounts, or new dishes.

A home-delivery order from the guest site is the same kitchen path with type `DELIVERY`, a generated `DLV-` id, and an unsettled bill. The guest does not pay in the browser. The counter collects it.

## Payments

- **Cash.** Open the drawer with a float first. Enter the amount the guest handed over. Change is recorded. The expected close is float plus cash sales (the bill amount, not the tendered note). Close the drawer with the counted cash. Variance is stored.
- **UPI.** The QR is `upi://pay?pa=…&am=…&cu=INR&tn=…` for that share. Scanning it opens a UPI app only if the VPA is real. Replace `restro@upi` before relying on it. Mark "Payment received" after you see the credit. There is no bank callback in this build.
- **Sandbox card.** Always available, with no keys. Billing redirects to `/pay/sandbox/:id`. The form is the only place the number is typed. The server checks it and stores `card_last4` and `card_brand`. There is no column for the PAN or CVV, and the number is not written to the log on purpose.
  - `4111111111111111` succeeds (Visa).
  - `5555555555554444` succeeds (Mastercard).
  - `4000000000000002` is declined.
  - `4000000000009995` is insufficient funds.
- **Razorpay test.** Set both keys. Billing shows "Razorpay test", which loads `checkout.razorpay.com` so the card fields are theirs. The return posts the payment id and signature; the server checks HMAC with the key secret.
- **Stripe test.** Set `STRIPE_SECRET_KEY` (`sk_test_…`). The guest leaves for Stripe Checkout. Use Stripe’s own test cards (their `4242…` card, not the sandbox number). The return page retrieves the Checkout Session and settles only when `payment_status` is `paid`.
- **PhonePe.** Shown only when the merchant id and salt are set. A failed upstream call is shown as a failure.

## Swiggy and Zomato

Billing → Swiggy or Zomato → **Simulate webhook** posts a sample order (`SWG-8821` or `ZOM-4490`) through the same function as the public webhook. The kitchen ticket is tagged PARCEL. The partner is treated as having already collected the money: the bill is `PREPAID`, with a `PLATFORM` payment. The sticker at `/print/sticker/:orderId` is about 80mm wide and shows the restaurant name, FSSAI, GSTIN, partner, delivery id in large type, a Code 128 barcode, a QR of the same id, the lines, the parcel charge, the total, and **PRE-PAID**. Print it from the browser onto a label printer (the system print dialog, 80mm paper).

Pickup is on the same tab. The kitchen must mark every line ready first. Lookup is the delivery id.

Public endpoints:

- `POST /api/webhooks/swiggy`
- `POST /api/webhooks/zomato`

Header `x-webhook-signature` is hex HMAC-SHA256 of the raw body using `AGGREGATOR_WEBHOOK_SECRET`. That header is a stand-in until a partner publishes their own canonical string. Comments in [`server/domain.ts`](server/domain.ts) (`ingestAggregator`) say this in the code.

`delivery_id` is unique. Sending `SWG-8821` twice returns the original order and does not fire a second ticket.

A line with `menuItemId` is priced from this menu, so a webhook cannot undercut a known dish. A line with only `name` and `price` is accepted for items the partner sends that are not on the card.

Example:

```json
{
  "delivery_id": "SWG-8821",
  "chef_note": "hand to rider",
  "items": [{ "menuItemId": 12, "qty": 1, "note": "no onion" }]
}
```

There is no live Swiggy or Zomato API in this build. The webhook is the adapter those APIs would call later.

## Guest sign-in

OTP, in order: Fast2SMS if `FAST2SMS_API_KEY` is set, otherwise Twilio if all three Twilio variables are set, otherwise the code is logged as `[otp] mobile … code …`. In development with `OTP_DEV_REVEAL=true` the same code is returned to the browser so you can finish the flow without a phone. That reveal is forced off when `NODE_ENV=production`.

Google uses the authorization-code flow. Create an OAuth client (Web) and set the redirect to `{APP_URL}/api/customer/google/callback`. Google does not give us a mobile number. Booking and delivery ask for one if it is missing. We store the Google `sub`, the name, and the email Google returns, because that is what their profile contains. The form itself asks only for name and mobile.

## Admin security

- Suspend on Desk → People. Every session for that person is revoked and their socket is disconnected. The next request is unauthorized, and a new sign-in is refused until you activate them.
- Revoke one session without suspending the person on Desk → Security.
- The audit log records sign-ins, failures, voids, discounts, price edits, drawer open and close, pickup, and setting changes. IP and device are on those rows.
- You cannot suspend your own user.

## API

All JSON bodies return `{ ok: true, data }` or `{ ok: false, error: { code, message, fields } }`. Staff routes take `Authorization: Bearer <token>` from the login response.

| Method | Path | Who |
| --- | --- | --- |
| GET | `/api/health` | anyone |
| GET | `/api/public/menu` | anyone |
| GET | `/api/public/config` | anyone |
| POST | `/api/auth/login` | anyone |
| POST | `/api/auth/logout` | staff |
| GET | `/api/auth/me` | staff |
| POST | `/api/auth/password` | staff |
| POST | `/api/auth/verify-pin` | waiter, admin |
| GET | `/api/tables` | staff |
| POST | `/api/orders` | waiter, admin |
| GET | `/api/orders/:id` | staff except chef |
| POST | `/api/orders/:id/bill-request` | waiter, billing, admin |
| POST | `/api/order-items/:id/void` | waiter with `{ pin }`, or admin |
| PATCH | `/api/order-items/:id/status` | chef, admin. Body `{ status: "PREPARING" \| "READY" }` |
| GET | `/api/kds?partner=SWIGGY` | chef, admin |
| GET | `/api/billing/orders` | billing, admin |
| POST | `/api/billing/orders/:id/discount` | billing, admin |
| POST | `/api/billing/orders/:id/split` | billing, admin |
| POST | `/api/billing/shares/:id/cash` | billing, admin |
| GET | `/api/billing/shares/:id/upi` | billing, admin |
| POST | `/api/billing/shares/:id/upi` | billing, admin. Marks the share received |
| POST | `/api/billing/shares/:id/card` | billing, admin. Body `{ gateway }` |
| GET/POST | `/api/billing/drawer` and `/open`, `/close` | billing, admin |
| GET | `/api/billing/orders/:id/sticker` | billing, admin |
| POST | `/api/billing/simulate` | billing, admin |
| POST | `/api/webhooks/swiggy` and `/zomato` | partner or local mock |
| POST | `/api/pickup` | billing, admin |
| POST | `/api/payments/mock/charge` | the sandbox page |
| POST | `/api/payments/razorpay/verify` | browser after Checkout |
| POST | `/api/payments/stripe/confirm` | return page |
| POST | `/api/payments/phonepe/confirm` | return page |
| GET/POST/PATCH | `/api/admin/staff`, `/sessions`, `/audit`, `/analytics`, `/settings`, `/pin`, `/menu`, `/bookings` | admin (billing can read bookings) |
| POST | `/api/customer/otp/request` and `/verify` | guest |
| GET | `/api/customer/google/start` and `/callback` | guest |
| POST | `/api/customer/bookings` and `/delivery` | guest |

Socket.io connects to the same origin (or `NEXT_PUBLIC_SOCKET_URL`) with `auth.token` set to the staff JWT. Events: `floor` and `session:revoked`.

Postman: import [`postman/restro.postman_collection.json`](postman/restro.postman_collection.json). Run **Public menu**, then the four logins, then **Waiter order**, **Chef status update**, **Open cash drawer**, **Billing settlement**. **Split bill** only works before any share is paid, so run it on a fresh order. **Aggregator webhook** and **Suspend user** are in the collection. Suspend is last: it locks `waiter@restro.com` until an admin activates them on the desk or you update `users.is_suspended`.

## Tests

```bash
npm test
npm run typecheck
npm run lint
```

Tests use `restro_test` (override with `TEST_DATABASE_URL`) and cover the owner menu shape, order → KOT → GST on a half tandoori, chef status without prices, PIN void, split across two sandbox cards, the declined card, drawer variance, the Swiggy webhook’s idempotency and sticker, signature rejection, suspend, and billing being blocked from the menu.

## Troubleshooting

- **`Could not reach PostgreSQL`.** The server is not running, or the password is not `postgres`. Start the Windows service "postgresql", or `docker compose up db`, or set `DATABASE_URL`.
- **Port 3847 in use.** `PORT=3850 npm run dev` and set `APP_URL` to match.
- **OTP never arrives.** With no Fast2SMS or Twilio key, read the terminal that runs `npm run dev`. The line starts with `[otp]`.
- **Google button missing.** Both client id and secret must be set, and the redirect URI must match `APP_URL`.
- **UPI app says the VPA is invalid.** `restro@upi` is not a real merchant. Put the restaurant VPA in Desk → Settings.
- **Cash is refused.** Open the drawer first.
- **Pickup is refused.** The kitchen has not marked every line ready.
- **Webhook 401 in production.** Set `AGGREGATOR_WEBHOOK_SECRET` and send `x-webhook-signature`, or use the signed-in Simulate button, which does not depend on that secret.
- **Two browsers, one ticket, the other does not move.** They are on different server processes. Use one Node process.
- **Demo login suddenly fails.** The account was suspended from the Postman "Suspend user" request or the desk. Sign in as admin and activate them.

## Free hosting

Checked against public docs and write-ups in November 2026. Free tiers move. Read the pricing page on the day you deploy.

**Use this pair if you want the live kitchen to work:**

1. **Neon** for Postgres. Their free plan is about 0.5 GB and the compute sleeps after a few minutes idle. Copy the connection string into `DATABASE_URL` (`sslmode=require` is fine). Do not use Render’s free Postgres for anything you want to keep: it expires about 30 days after creation, then there is a short grace period before the data is deleted. Render’s own docs say not to use it for production.
2. **Render** free web service for this whole app (`render.yaml`). One Node process can hold Socket.io. The free instance sleeps after about 15 minutes without traffic and the first hit takes about a minute. The workspace includes a limited pool of free hours per month. Set `JWT_SECRET`, `DATABASE_URL`, `APP_URL` (the `https://…onrender.com` URL), and `OTP_DEV_REVEAL=false`. The free subdomain is the `onrender.com` host. A custom domain on Render’s hobby workspace is limited; a `CNAME` to that host is the usual step once you have a domain.

Build and start are already in `render.yaml`: `npm ci && npm run build`, then `node scripts/start.mjs` (migrate, seed, listen on `$PORT`).

**Vercel** can host the Next.js pages, not this Socket.io server. Vercel’s free Hobby tier is built for serverless functions with a short execution limit, which drops long-lived sockets. If you still want the UI there:

- Deploy the API with Render as above.
- On Vercel, set `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_SOCKET_URL` to the Render origin, and on Render set `CLIENT_ORIGIN` to the Vercel origin.
- `vercel.json` is not required; the project is a normal Next.js app besides the custom server, which Vercel will not run. The pages call the API with those public URLs.

A `*.vercel.app` hostname is the free subdomain.

**Cloudflare Workers** are a poor fit for this process: Socket.io and a Postgres pool want a long-running Node server. Cloudflare Pages can host a static frontend the same way Vercel can, with the same split. This repo does not ship a Workers config, because claiming it would run there would be false.

**Koyeb**, as of early 2026, still documents a tiny free instance, but new accounts were being steered onto a paid plan and the free instance scales to zero. It is not the path this README recommends.

**Supabase** free Postgres (about 500 MB, projects pause after a week idle) is a workable alternative to Neon. Point `DATABASE_URL` at the pooler string. This app does not use Supabase Auth or Realtime.

**A name of your own.** `onrender.com` and `vercel.app` are the free hostnames. For a domain you control, Cloudflare Registrar and Namecheap both sell names at cost-ish prices; there is no reliable free public registrar left (Freenom is not a serious option). Point a `CNAME` for `order.yourdomain.com` at the Render host and set `APP_URL` to that `https` origin.

After the first deploy, sign in as admin and change the four passwords, the PIN `2580`, the UPI VPA, GSTIN, and FSSAI before printing a sticker or taking a real payment.


## Local premium design update (8 November 2026)

- Node.js **20.19 or newer** required. This PC has private Node 22.21.1 under %LOCALAPPDATA%\restro-node; double-click run-restro.cmd. The private runtime does not change other applications. Port remains 3847.
- Original source, package manifests and README backed up in restro-pre-design-20261108.zip before redesign. Stop Restro before restoring.
- Customer site: cinematic food hero, live featured-dish horizontal carousel, photographed category chips, searchable image menu, veg filter, configurable dish dialog, quantity controls, sticky delivery bag, booking CTA and live restaurant-details footer. Menu/price/order API contracts remain unchanged.
- Staff: photographic staff entrance, consistent icon navigation, refined 15-table grid, thumbnail ordering menu, live kitchen columns with counts and empty states, unified dark glass panels and printable receipt styling. No database or payment-provider credentials changed.
- Images: seven free Pexels source photos plus a hero crop, stored locally as optimized WebP in public/images. No hotlinks. Images represent cuisine categories, not the actual restaurant dishes; the UI discloses this. See CREDITS.md for photographer, original URLs and license. next/image provides responsive sizes, lazy loading (hero eager), and local optimization.
- Display font uses Georgia for an editorial serif alongside Manrope. Motion respects reduced-motion preferences. Visible keyboard focus styles included.
- To verify with the private runtime: prepend its node-v22.21.1-win-x64 folder to PATH, then npm run typecheck, npm run lint, npm test and npm run build. Start run-restro.cmd afterward.
- Menu names, prices, availability, restaurant name/address/hours still come from PostgreSQL. This redesign does not connect live aggregators, enable real card charges, or configure SMS/Google/merchant credentials. Existing integration limitations remain.

### Design verification & security notes

- scripts/verify-design.ps1 runs typecheck, lint, the complete test suite against **restro_design_test** (an isolated new app-test database), then a production build. The tests truncate only that test database, never restro_db or trading databases. The default npm test expects restro_test unless TEST_DATABASE_URL is supplied.
- Upgraded Next.js and eslint-config-next from 15.5.4 to the compatible security patch 15.5.29 after the pre-existing audit flagged critical runtime advisories. See design-audit.json for dependency audit details; remaining advisories need review before internet exposure. No forced major-version upgrades were applied.
- Local screenshot tooling uses Playwright with the existing Chrome installation. Screenshots and browser verification are saved in screenshots/. No cloud build was used for this redesign.
## Local redesign report

See DESIGN_REPORT.md for the redesign scope, original-source backup, verification commands and remaining security advisories. See CREDITS.md for local image provenance. The latest browser checks are recorded in screenshots/verification.json, with desktop/mobile and role-screen PNGs in screenshots/.
