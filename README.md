# Hotzonex Cloud

MikroTik hotspot voucher management for Hotzonex WiFi in Juba, South Sudan
(sites: Gorom, Jebel Iraq, HQ, Sub-Office — one RouterOS v7 router per site).

It does five things: **add routers**, **create vouchers** and push them to the router,
**print** A4 card sheets and thermal receipts, **sell** vouchers for cash at a cashier screen,
and **report** sales and usage by day, week and month. Money is whole South Sudanese Pounds (SSP);
all times are Africa/Juba (UTC+2).

## How it fits together

```
Browser (staff)  ──►  Supabase (tables, login, router_jobs queue, Edge Functions)
                               ▲
                               │  outbound HTTPS from each router, every 30 s
                               │  (router-gateway Edge Function)
                               │
                 MikroTik routers (RouterOS 7.19+, any internet: Starlink, 4G, fibre)
```

- **The routers connect to the cloud by themselves.** Each router runs a small script (installed
  once by pasting a setup script into Winbox → New Terminal) that calls the `router-gateway`
  Edge Function every 30 seconds over HTTPS. The reply is the router's next work as RouterOS
  commands; the router runs them and sends the results on its next call.
- No computer on the router's network, no VPN or tunnel, no port forwarding and no public IP.
  It works behind CGNAT (Starlink, mobile data).
- The browser never talks to a router. It writes a job (for example "push vouchers") and the
  router picks it up on its next call.

| Folder | What it is | Runs on |
| --- | --- | --- |
| `web/` | React 18 + TypeScript + Vite + Tailwind staff app | Vercel |
| `supabase/` | Database migrations, seed and Edge Functions (`add-router`, `create-staff`, `router-gateway`) | Supabase |

---

## 1. Supabase

1. Create a project at <https://supabase.com> (pick the region closest to Juba, e.g. Frankfurt).
2. **Authentication → Providers → Email**: keep Email on and turn **off** "Allow new users to sign up".
3. Install the [Supabase CLI](https://supabase.com/docs/guides/cli), then from the repository root:

   ```bash
   supabase login
   supabase link --project-ref <your-project-ref>     # Project Settings → General → Reference ID
   supabase db push                                   # runs every file in supabase/migrations
   ```

4. **Edge Functions.** No secrets to set (`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided
   automatically):

   ```bash
   supabase functions deploy add-router
   supabase functions deploy create-staff
   supabase functions deploy router-gateway --no-verify-jwt   # routers have no user login; they use their token
   ```

5. **Seed.** Open `supabase/seed.sql`, change the admin email and password at the top, and run it
   in **SQL Editor**. It creates the **HQ** site, the first admin login and three sample plans
   (2 Hours 1,000 SSP · 1 Day 3,000 SSP · 1 Week 15,000 SSP). Running it twice is safe.
   After the first login, change that password (Authentication → Users → Send password reset).

Local development instead: `supabase start` then `supabase db reset` (runs migrations and seed).

## 2. Web app

```bash
cd web
cp .env.example .env      # VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm install
npm run dev               # http://localhost:5173
```

### Deploy to Vercel

1. Import the GitHub repository in Vercel (**Add New → Project**).
2. **Root Directory:** `web`. Framework, build command (`npm run build`) and output (`dist`)
   come from `web/vercel.json`, which also routes every page to the app and sets security headers.
3. **Environment Variables:** `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (same values as
   `web/.env`). Deploy.
4. In Supabase **Authentication → URL Configuration**, set **Site URL** to the Vercel address.

Every push to the main branch then redeploys the web app.

## 3. Connect each router

1. The router needs **RouterOS 7.19 or newer** (built-in root certificates, used to check
   Hotzonex Cloud's HTTPS certificate) and internet access. Update in Winbox → System → Packages →
   Check For Updates.
2. The router needs a working hotspot (IP → Hotspot → Hotspot Setup). Note its **server name**
   (IP → Hotspot → Servers, e.g. `hotspot1` — not the Wi-Fi name) and the **DNS name** of its
   hotspot profile (e.g. `hotzonex.wifi`).
3. On the website: **Routers → Add router** → name, site, hotspot server name, DNS name →
   **Save and get setup script**.
4. Click **Copy setup script**, open Winbox → **New Terminal**, paste and press Enter.
5. The page shows **Online** within a minute, then the plans' hotspot profiles are created.

The setup script adds a script and a 10-second scheduler named `hzc-cloud` to the router. It
contains the router's own secret token; the database keeps only its SHA-256. **Routers → Setup
script** makes a new token (the old connector stops working until the new script is pasted).
To disconnect a router: `/system scheduler remove [find name="hzc-cloud"]` and
`/system script remove [find name="hzc-cloud"]`.

## 5. First-day checklist

1. Log in as the admin.
2. **Routers → Sites:** add your sites (Gorom, Jebel Iraq, Sub-Office…).
3. **Routers → Add router** for each site → paste its setup script into the router. It must show *Online* with the model and RouterOS version.
4. **Plans:** check prices, time, validity, speed and colours. Each save updates the router profiles.
5. **Staff:** create managers and sellers (each with a site).
6. **Vouchers → Generate vouchers:** wait for the batch to show **Ready**.
7. **Vouchers → Print cards** for pre-printed cards, and/or sell from the **Sell** screen.

---

## Environment variables

| Where | Variable | What / where to get it |
| --- | --- | --- |
| `web/.env`, Vercel | `VITE_SUPABASE_URL` | Supabase → Project Settings → API → Project URL |
| `web/.env`, Vercel | `VITE_SUPABASE_ANON_KEY` | Supabase → Project Settings → API → `anon` public key |

---

## Using the app

### Roles

| Role | Menu | Can do |
| --- | --- | --- |
| Admin | Dashboard, Sell, Vouchers, Plans, Routers, Sales, Reports, Active Users, Staff | Everything, all sites; voids; Disconnect |
| Manager | Dashboard, Sell, Vouchers, Sales, Reports, Active Users | Own site: generate and print vouchers, sell, mark as sold, sales and reports |
| Seller | Sell, Sales | Own site: sell and print receipts; sees only own sales for today |

### Router jobs (run by the router on its next call)

| Job | When | What happens on the router |
| --- | --- | --- |
| `test_connection` | Router added/edited, **Test again** | Checks the hotspot server exists and reads its DNS name, model and RouterOS version; warns if the DNS name differs |
| `sync_profiles` | Plan saved, new router passes its test | Creates/updates `/ip hotspot user profile` (`rate-limit`, `shared-users`) |
| `push_vouchers` | Vouchers generated, **Retry push** | Adds each voucher as `/ip hotspot user`: name = password = code, profile, `server`, `limit-uptime`, `limit-bytes-total`, `comment=hzc:<voucher_id>`; 80 per call |
| `disable_voucher` | Admin voids a sale | Disables the tagged user and closes its sessions |
| `disconnect_user` | **Disconnect** on Active Users | Closes that user's session |

Every router write is safe to repeat: the router checks first and only touches users tagged
`hzc:<voucher_id>`. A code that already belongs to another hotspot user is never changed; that
voucher is disabled instead. A job whose results do not come back is sent again (up to 3 times).
If a router goes offline during a push, the progress is kept and the push resumes by itself.

### Usage sync and expiry (every minute per online router)

Each router reports who is online and each used voucher's counters; the database then updates the
Active Users list, sets first login (`first_used_at`, `expires_at` = first login + plan validity,
status **active**) and marks vouchers **expired** when time, validity or data is used up. The router
itself stops users at their time and data limits; when **validity** ends while a customer is online
the session is closed. Expired vouchers are removed from the router only once offline. A router
that stops calling in for 2 minutes is shown offline and its user list is cleared.

### Selling

- **Sell screen:** one big button per plan (price, duration, cards left; yellow below 20,
  disabled at 0). Each tap sells one voucher — two cashiers can never get the same code — and
  shows it full-screen with **Print receipt** and **Sell another**.
- **Pre-printed cards** are never sold on the Sell screen. Record them with
  **Sales → Mark printed cards as sold**, or switch on **Sell on first login** for the site
  (Routers → Sites): the first time an unused card logs in, a cash sale is recorded with no seller.
- **Voids:** admins only, within 24 hours, with a reason. The sale stays listed as voided, is left
  out of all totals, and the voucher is disabled on the router.

### Printing

- **A4 cards:** Vouchers → **Print cards**; 24, 40 or 50 per page (50 fits codes up to 8 digits).
  In the print window: **A4, portrait, scale 100%, default margins, no headers/footers**, and tick
  **Background graphics** so plan colours print. Clicking Print marks the cards as printed (not a
  sale); if the print failed, click **Unmark these cards** straight away.
- **Receipts:** 58 mm or 80 mm thermal paper (remembered per device); set the printer's paper size to match.

### Reports

- **Dashboard:** today / this week (Mon–Sun) / this month revenue, users online now, revenue for
  the last 14 days, and stock left per plan per site.
- **Reports:** Daily, Weekly and Monthly tabs with filters for site, plan and seller. Sections:
  summary with change versus the previous period, by plan, by seller, by site, sales per hour
  (daily) or per day (weekly; monthly with weekly subtotals), and voucher status.
  **Print** gives a clean A4 report; **Export CSV** opens in Excel.
- All totals come from SQL functions in Africa/Juba time and always exclude voided sales.

---

## Security

- Row Level Security is on for every table; policies read the caller's role and site from `profiles`.
- Sales and voucher status change only through `SECURITY DEFINER` database functions; the browser
  cannot insert sales or edit vouchers directly.
- No router passwords are stored. Each router has a random 256-bit token (only its SHA-256 is in the
  database, never readable by the browser) and checks Hotzonex Cloud's HTTPS certificate
  (`check-certificate=yes-without-crl`), so the commands it runs can only come from Hotzonex Cloud.
- The service role key never leaves Supabase (Edge Functions only).
- Admin actions (router added/updated/removed, staff created/updated, sale voided) are written to `audit_log`.

## Backups

- **Database:** Supabase Pro projects have daily backups (Database → Backups). On any plan, also
  keep your own copy at least weekly and before big changes:
  `supabase db dump --linked -f backup-$(date +%F).sql` and
  `supabase db dump --linked --data-only -f data-$(date +%F).sql`. Store copies somewhere safe
  (cloud drive or USB kept elsewhere).
- **Routers:** `/export file=hotzonex-backup` in each router terminal, then download the `.rsc`
  from Files. Vouchers on a reset router can be pushed again with **Retry push**.

## Troubleshooting

| What you see | What to check |
| --- | --- |
| Router stays "Waiting for router" | The setup script was not pasted, or the router has no internet. In the router terminal run `/system script run hzc-cloud` and `/log print where topics~"script"` |
| `failure: SSL: ... certificate` or nothing happens on RouterOS older than 7.19 | Update RouterOS (System → Packages → Check For Updates), then run `/certificate settings set builtin-trust-anchors=trusted` |
| "Hotspot server … was not found on this router" | Edit the router and use one of the server names listed in the message (IP → Hotspot → Servers) |
| Router shows Offline | It has not called in for 2 minutes: power, internet, or the `hzc-cloud` scheduler was removed (paste the setup script again) |
| "Unknown router" in the router log | The token was replaced: **Routers → Setup script** and paste the new script |
| Batch stuck on "Push failed" | Router offline; it resumes by itself when back, or press **Retry push** |

## Development

```bash
npm run install:all      # web dependencies
npm run typecheck        # strict TypeScript for the web app
npm test                 # RouterOS script builder and report parser (Node 22.18+)
npm run build:web
```

Migrations are in `supabase/migrations/` (one file per build phase, applied in order).
