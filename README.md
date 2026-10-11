# Hotzonex Cloud

MikroTik hotspot voucher management for Hotzonex WiFi in Juba, South Sudan
(sites: Gorom, Jebel Iraq, HQ, Sub-Office — one RouterOS v7 router per site).

It does five things: **add routers**, **create vouchers** and push them to the router,
**print** A4 card sheets and thermal receipts, **sell** vouchers for cash at a cashier screen,
and **report** sales and usage by day, week and month. Money is whole South Sudanese Pounds (SSP);
all times are Africa/Juba (UTC+2).

## How it fits together

```
Browser (staff) ──► Supabase (tables, login, router_jobs queue, Edge Functions)
                        │                                   ▲
   direct: router-direct calls the router's REST API        │ cloud: the router calls
   at its public IP / DNS name with its admin login         │ router-gateway every 30 s
                        ▼                                   │
                 MikroTik routers (RouterOS 7)  ────────────┘
```

Each router is added in one of two ways (Routers → Add router):

| | **IP address, username and password** (direct) | **Router connects to Hotzonex Cloud** (cloud) |
| --- | --- | --- |
| What you enter | Public IP or DNS name, port, HTTPS on/off, admin username and password | Nothing extra: paste a setup script into Winbox once |
| Router needs | A public IP (not behind CGNAT), the `www-ssl` (or `www`) service reachable from the internet, RouterOS 7.1+ | Internet access, RouterOS 7.19+ |
| How work reaches it | `router-direct` Edge Function, woken when a job is queued and every minute (pg_cron + pg_net) | The router's `hzc-cloud` scheduler calls `router-gateway` and runs the commands it gets back |
| Stored | Password encrypted (AES-256-GCM, key in Supabase Vault) | Only the SHA-256 of a random token |

**Hotzonex uses the router as you set it up.** The connection test only *reads* the router's
hotspot servers, server profiles (DNS name, login methods) and user profiles, and shows them on
the Routers page. It never creates or changes the hotspot, its profiles, the firewall or any other
setting. What it does write is limited to:

- hotspot users for its vouchers, each tagged `comment=hzc:<voucher id>` (only tagged users are ever disabled or removed);
- a plan's user profile **only when the router has no profile with that name** (existing profiles are never changed — set a plan's
  "Router user profile" to one of your own profiles to use it as it is);
- closing hotspot sessions (validity ended, voided sale, **Disconnect**).

| Folder | What it is | Runs on |
| --- | --- | --- |
| `web/` | React 18 + TypeScript + Vite + Tailwind staff app | Vercel |
| `supabase/` | Migrations, seed and Edge Functions (`add-router`, `create-staff`, `router-gateway`, `router-direct`) | Supabase |

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

4. **Edge Functions.** No secrets to set: `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided
   automatically, and the router password key is generated in Supabase Vault by a migration.

   ```bash
   supabase functions deploy add-router
   supabase functions deploy create-staff
   supabase functions deploy router-gateway --no-verify-jwt   # called by routers (token checked inside)
   supabase functions deploy router-direct --no-verify-jwt    # called by the database (secret checked inside)
   ```

   For another Supabase project, change the `direct_worker_url` row in `app_config`
   (migration `…_router_secrets_in_vault.sql`) to that project's URL.

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

First set up the hotspot on the router yourself as you like it (IP → Hotspot → Hotspot Setup).
Note its **server name** (IP → Hotspot → Servers, e.g. `hotspot1` — not the Wi-Fi name) and the
**DNS name** of its hotspot profile. Then on the website: **Routers → Add router** and choose:

**A. IP address, username and password**

1. The router must be reachable from the internet: a public IP from your provider (Winbox → IP →
   Cloud shows the public address and a free DNS name like `abc123.sn.mynetname.net`).
   Private addresses (192.168.x.x, 10.x.x.x, 172.16–31.x.x, 100.64–127.x.x) are refused.
2. Turn on `www-ssl` (recommended) or `www` in IP → Services and allow that port from the internet.
   For HTTPS the router needs a trusted certificate, e.g. `/certificate enable-ssl-certificate dns-name=<your IP Cloud name>`.
3. Enter the address, port, admin username and password → **Save and connect**. Hotzonex reads
   the hotspot setup and shows it. The router is then checked every minute.

**B. Router connects to Hotzonex Cloud** (no public IP needed)

1. RouterOS 7.19 or newer (System → Packages → Check For Updates).
2. **Save and get setup script** → **Copy setup script** → Winbox → **New Terminal** → paste → Enter.
3. The page shows **Online** within a minute.

The setup script only adds a script and a 30-second scheduler named `hzc-cloud`, with the
`read,write,test,ftp` permissions; it changes no other setting. If the router stays "Waiting"
after an upgrade from an older RouterOS, it may not trust certificates yet; allow that with
`/certificate settings set builtin-trust-anchors=trusted`. To disconnect:
`/system scheduler remove [find name="hzc-cloud"]` and `/system script remove [find name="hzc-cloud"]`.

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

### Router jobs

| Job | When | What happens on the router |
| --- | --- | --- |
| `test_connection` | Router added/edited, **Test again** | Reads (never changes) the router's hotspot servers, server profiles and user profiles; checks the chosen hotspot server exists; warns if the DNS name differs or a plan's profile is missing |
| `sync_profiles` | Plan saved, new router passes its test | Adds the plan's `/ip hotspot user profile` only if the router has none with that name; existing profiles are never changed |
| `push_vouchers` | Vouchers generated, **Retry push** | Adds each voucher as `/ip hotspot user`: name = password = code, profile, `server`, `limit-uptime`, `limit-bytes-total`, `comment=hzc:<voucher_id>` |
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
- Direct routers: the admin password is encrypted with AES-256-GCM; the key is in Supabase Vault and
  readable only by the service role. The browser can never read `password_enc` (column grant).
  Use HTTPS so the password does not cross the internet in clear text.
- Cloud routers: no password is stored. Each router has a random 256-bit token (only its SHA-256 is in
  the database) and checks Hotzonex Cloud's HTTPS certificate, so the commands it runs can only come
  from Hotzonex Cloud. Protect the Supabase account with a strong password and two-factor sign-in.
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
| "… is a private address …" | Direct needs the router's public IP or DNS name. Without a public IP, use "Router connects to Hotzonex Cloud" |
| "No reply from …" / "refused the connection" | Direct: public IP correct, `www-ssl`/`www` on, port allowed from the internet in the router firewall, not behind CGNAT |
| "Wrong router username or password" / "may not use the REST API" | The admin login; its group needs read, write, api and rest-api |
| "HTTPS certificate is not trusted" | Give the router a real certificate (`/certificate enable-ssl-certificate …`) or switch HTTPS off |
| Router stays "Waiting for router" | Cloud: the setup script was not pasted, or the router has no internet. Run `/system script run hzc-cloud` and `/log print where topics~"script"` |
| "Hotspot server … was not found on this router" | Edit the router and use one of the server names listed in the message (IP → Hotspot → Servers) |
| Router shows Offline | Cloud: it has not called in for 2 minutes. Direct: the minute check could not reach it (the reason is shown) |
| Batch stuck on "Push failed" | Router offline; it resumes by itself when back, or press **Retry push** |

## Development

```bash
npm run install:all      # web dependencies
npm run typecheck        # strict TypeScript for the web app
npm test                 # RouterOS script builder and report parser (Node 22.18+)
npm run build:web
```

Migrations are in `supabase/migrations/` (one file per build phase, applied in order).
