# Deploying Cooked by Ugo on Cloudflare

This follows Nicholas's Cloudflare guide, adapted to how the apps are built. The customer site and
the admin are static Vite apps, so both run on Cloudflare Workers for free. Only the API needs a
server: it runs on the free Oracle VM, reachable only through a Cloudflare Tunnel.

| Address                  | What                          | Where                                    |
| ------------------------ | ----------------------------- | ---------------------------------------- |
| `cookedbyugo.com`, `www` | Customer site (`cook-by-ugo`) | Cloudflare Workers                       |
| `admin.cookedbyugo.com`  | Admin (`admin-cook-by-ugo`)   | Cloudflare Workers, behind Access        |
| `api.cookedbyugo.com`    | API (this repo)               | Oracle VM, port 3001, through the tunnel |

Pushing to `main` deploys all three: Cloudflare rebuilds the two sites, and the VM pulls the API
within a minute. GitHub Actions runs the lint, type checks and tests on every push.

## 1. DNS (done)

The domain is on Cloudflare with Namecheap as registrar. Set **SSL/TLS → Full (strict)** and turn
on **Always Use HTTPS**.

## 2. The two sites on Workers

Do this once for `cook-by-ugo` and once for `admin-cook-by-ugo`.

1. **Workers & Pages → Create → Import a repository**, and pick the repo.
2. Build command: `npm run build`. Deploy command: `npx wrangler deploy`.
3. Build variable: `VITE_API_URL=https://api.cookedbyugo.com`. It is baked in at build time, so
   redeploy after changing it.
4. After the first deploy, **Settings → Domains & Routes → Add custom domain**: `cookedbyugo.com`
   and `www.cookedbyugo.com` for the site, `admin.cookedbyugo.com` for the admin.

Each repo has a `wrangler.jsonc` that serves `dist` and sends unknown paths to `index.html`, and a
`public/_headers` file with security headers. `npm run preview:cloudflare` runs it locally.

## 3. The API on the VM

On the Oracle VM (Ubuntu, Ampere):

```bash
# Node 22, git and PM2
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs git
sudo npm install -g pm2

git clone https://github.com/idungstanley/api-cooked-by-ugo.git
cd api-cooked-by-ugo
cp .env.example .env   # then fill it in, see below
npm ci --include=dev && npm run build
pm2 start ecosystem.config.cjs
pm2 save && pm2 startup   # run the command it prints, so the API starts after a reboot
```

Fill in `.env` on the VM. Never commit it.

```
NODE_ENV=production
PORT=3001
HOST=127.0.0.1
TRUST_CLOUDFLARE=true
MONGODB_URI=...
JWT_SECRET=...            # openssl rand -base64 48
ALLOWED_ORIGINS=https://cookedbyugo.com,https://www.cookedbyugo.com,https://admin.cookedbyugo.com
ADMIN_URL=https://admin.cookedbyugo.com
SITE_URL=https://cookedbyugo.com
STRIPE_SECRET_KEY=...
STRIPE_PUBLISHABLE_KEY=...
STRIPE_WEBHOOK_SECRET=...
BREVO_API_KEY=...
EMAIL_FROM=orders@cookedbyugo.com
KITCHEN_EMAIL=...
CLOUDINARY_URL=...
```

`HOST=127.0.0.1` means only the tunnel on the same machine can reach the API.
`TRUST_CLOUDFLARE=true` makes rate limits use each visitor's real address from Cloudflare.

**Automatic deploys.** Add this line with `crontab -e`. Every minute it checks GitHub, and when
`main` has changed it builds and restarts the API. A failed build leaves the running version alone.

```
* * * * * /home/ubuntu/api-cooked-by-ugo/scripts/auto-deploy.sh >> /home/ubuntu/deploy.log 2>&1
```

**Firewall.** Allow no inbound ports except SSH from your own IP. The tunnel and the deploy script
both connect outwards.

## 4. Cloudflare Tunnel

1. **Zero Trust → Networks → Tunnels → Create tunnel**, and run the install command it gives you
   on the VM.
2. Add one public hostname: `api.cookedbyugo.com` → `http://localhost:3001`.

The admin does not need the tunnel: it is a static site on Workers that talks to the API.

## 5. Lock the admin with Cloudflare Access

1. **Zero Trust → Access → Applications → Add an application → Self-hosted**.
2. Domain: `admin.cookedbyugo.com`.
3. Policy: **Allow**, including only the approved staff emails.
4. Login method: one-time PIN by email, or Google.

Staff then pass Access and the admin's own sign-in, with two-factor for the owner.

## 6. MongoDB, Stripe and email

- **Atlas → Network Access:** add the VM's public IP, then remove `0.0.0.0/0`.
- **Stripe → Developers → Webhooks → Add endpoint:**
  `https://api.cookedbyugo.com/api/webhooks/stripe`, with the event `payment_intent.succeeded`.
  Copy its signing secret into `STRIPE_WEBHOOK_SECRET`. This app takes payment with Stripe's
  payment form (Payment Intents), not hosted Checkout, so the guide's `checkout.session.completed`
  event and success or cancel URLs do not apply.
- A restricted key (`rk_live_…`) works for `STRIPE_SECRET_KEY` if it can write PaymentIntents and
  Refunds.
- **Stripe → Settings → Payment method domains:** add `cookedbyugo.com` and `www.cookedbyugo.com`
  for Apple Pay and Google Pay.
- **Brevo:** authenticate `cookedbyugo.com` (SPF, DKIM and DMARC records go in Cloudflare DNS), so
  order emails arrive.

## Go-live checklist

- [ ] Cloudflare shows the domain as Active, with Full (strict) TLS
- [ ] `cookedbyugo.com` and `www` load the site over HTTPS
- [ ] `https://api.cookedbyugo.com/health` returns `{"status":"ok"}`
- [ ] `admin.cookedbyugo.com` asks for the Cloudflare Access login first
- [ ] Atlas allows only the VM's IP
- [ ] The Stripe webhook is live and its secret is on the VM
- [ ] A real £1–£2 order completes, shows in the admin, and is refunded from the admin
- [ ] An order email arrives
- [ ] The business is registered with the ICO, which most businesses handling customer data must do
