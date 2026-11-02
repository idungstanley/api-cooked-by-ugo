# Cooked by Ugo API

The backend for the [customer site](https://github.com/idungstanley/cook-by-ugo) and the
[admin dashboard](https://github.com/idungstanley/admin-cook-by-ugo). It owns all business rules:
prices, order checks, staff access, refunds and live updates.

## Stack

Node.js, TypeScript, Express, MongoDB with Mongoose, Socket.IO, Stripe, Brevo and Cloudinary.

## Getting started

```bash
npm install
cp .env.example .env
```

In `.env`, set `JWT_SECRET` (generate one with `openssl rand -base64 48`) and `SEED_PASSWORD`.

```bash
npm run db:dev   # local MongoDB, no install needed. Keep this running.
npm run seed     # in a second terminal: menu, settings and sample staff
npm run dev      # API on http://localhost:4000
```

Sign in to the admin dashboard with `owner@example.com`, `kitchen@example.com` or
`rider@example.com`, using your `SEED_PASSWORD`. Sample staff are never created in production.

`docker compose up` is an alternative to `npm run db:dev`.

| Script             | What it does                           |
| ------------------ | -------------------------------------- |
| `npm run db:dev`   | Start a local MongoDB                  |
| `npm run db:reset` | Wipe the local database                |
| `npm run seed`     | Add starting data, without overwriting |
| `npm run dev`      | Start the API with reload              |
| `npm test`         | Run tests on a temporary database      |
| `npm run lint`     | Run ESLint                             |
| `npm run build`    | Compile to `dist`                      |

## Local services

With no keys set, the API still runs locally:

- **Stripe:** card orders are marked as paid straight away. This never happens in production,
  because the API refuses to start there without Stripe keys.
- **Brevo:** emails are printed to the console.
- **Cloudinary:** images are saved to `uploads/`.

## How it is organised

```text
src/
  config/      Environment checks and shared rules
  lib/         Small helpers
  middleware/  Auth, permissions, validation, rate limits, errors
  modules/     One folder per area, with models and routes
  seed/        Starting data
  services/    Email, payments, realtime and scheduled jobs
tests/         End-to-end API tests
```

Routes are under `/api`. Everything in `/api/public` is open to customers. Everything else needs a
staff session, and `requirePermission` checks the role on each route.

## Key rules

- **Prices:** `modules/orders/pricing.ts` is the only source of prices. Totals sent by a browser
  are ignored.
- **Card orders:** an order stays `pending-payment` until Stripe's signed webhook confirms it.
  Unpaid orders expire after 30 minutes.
- **Duplicates:** the customer site sends an idempotency key, so a double tap creates one order.
  Refunds and status changes use guarded updates, so simultaneous requests cannot apply twice.
- **Guests:** customers have no accounts. Tracking needs the private key from checkout, and returns
  no personal details.
- **Sessions:** staff use an httpOnly cookie. Changing a password, a role or active status signs
  that person out everywhere.

## Going live

1. Create a MongoDB Atlas cluster, and allow only the API's network access.
2. Set every value in `.env.example`, with `NODE_ENV=production`. The API refuses to start if a
   required key is missing.
3. Host the API on the same parent domain as the admin dashboard, such as `api.example.com` and
   `admin.example.com`. The session cookie is `SameSite=Lax`, so sign-in fails across different
   domains.
4. Set `ALLOWED_ORIGINS` to the two live website addresses.
5. Add a Stripe webhook to `https://<api>/api/webhooks/stripe` for `payment_intent.succeeded`.
6. Set up the sender domain in Brevo, with SPF, DKIM and DMARC.
7. Run `npm run seed` to load the starting menu and settings. To create the first owner, add a
   staff record with the role `owner` and send them a password reset.

## Still to do

- Run one instance only for now. Rate limits and Socket.IO keep their state in memory, so a second
  instance needs a shared store such as Redis.
- `GET /api/orders` returns the newest 10,000 orders for history and reports. Move these to
  paginated queries and server-side reports as volume grows.
- Move delivery time slots to later days. They currently cover today only.
