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
                               │  outbound HTTPS only (polls jobs, writes results)
                               │
                      Router Agent (always-on PC on the router LAN)
                               │  RouterOS v7 REST over the LAN
                               ▼
                 MikroTik routers (private IPs, e.g. 192.168.88.1)
```

- The browser never talks to a router. It writes a job (for example "test connection") and the
  **Router Agent** on the LAN runs it against the router's private IP, then writes the result back.
- The agent only makes outbound connections: no port forwarding, VPN, tunnel or public IP anywhere.

| Folder | What it is | Runs on |
| --- | --- | --- |
| `web/` | React 18 + TypeScript + Vite + Tailwind staff app | Vercel |
| `supabase/` | Database migrations, seed and Edge Functions (`add-router`, `create-staff`) | Supabase |
| `agent/` | Router Agent (Node.js 20, TypeScript) | Always-on PC / mini PC on the router LAN |

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

4. **Router password key.** Generate it once and keep a copy somewhere safe (password manager).
   The same value goes into the Edge Function secret and the agent's `.env`. If it is lost, every
   router password has to be entered again.

   ```bash
   openssl rand -hex 32                               # 64 hex characters
   supabase secrets set ROUTER_SECRET_KEY=<that-value>
   supabase functions deploy add-router
   supabase functions deploy create-staff
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

## 3. Router Agent (on the router LAN)

Use an always-on computer (PC, mini PC, Raspberry Pi 4+) on the same network as the routers,
with **Node.js 20 or newer** and internet access.

```bash
cd agent
cp .env.example .env      # SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ROUTER_SECRET_KEY
npm install
npm run check             # must print "Connected to Supabase" and "OK" for each router
npm start                 # builds and runs; Ctrl+C to stop
```

**Run it as a service so it restarts after power cuts** (pick one):

| System | Steps |
| --- | --- |
| Linux, PM2 | `sudo npm i -g pm2 && npm run build && pm2 start ecosystem.config.cjs && pm2 save && pm2 startup` (run the command `pm2 startup` prints) |
| Linux, systemd | Copy the agent to `/opt/hotzonex/agent`, `sudo useradd -r hotzonex`, `npm install && npm run build`, then `sudo cp deploy/hotzonex-agent.service /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl enable --now hotzonex-agent`. Logs: `journalctl -u hotzonex-agent -f` |
| Windows, NSSM | `winget install NSSM.NSSM`; in an Administrator PowerShell in the agent folder: `npm install; npm run build; .\deploy\install-windows-service.ps1`. Logs: `agent\logs\` |

Give the agent PC a fixed LAN IP (DHCP reservation) — the routers only accept REST calls from it.

## 4. Prepare each router

In Winbox → **New Terminal** (use the agent PC's LAN IP and a strong password):

```
/ip service set www disabled=no port=80 address=<agent-PC-IP>/32
/user group add name=hzc-api policy=read,write,api,rest-api,test
/user add name=hzc-api group=hzc-api password=<strong-password>
```

The router also needs a working hotspot (IP → Hotspot → Hotspot Setup). Note its **server name**
(e.g. `hotspot1`) and the **DNS name** of its hotspot profile (e.g. `hotzonex.wifi`).

## 5. First-day checklist

1. Log in as the admin.
2. **Routers → Sites:** add your sites (Gorom, Jebel Iraq, Sub-Office…).
3. **Routers → Add router** for each site → **Save and test**. It must show *online* with the model and RouterOS version.
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
| `agent/.env` | `SUPABASE_URL` | Same Project URL |
| `agent/.env` | `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API → `service_role` key. **Secret: only on the agent PC** |
| `agent/.env` | `ROUTER_SECRET_KEY` | The 64-hex key from step 1.4 (must equal the Edge Function secret) |
| `agent/.env` | `JOB_POLL_INTERVAL_MS` | Job queue poll, default `3000` |
| `agent/.env` | `SYNC_INTERVAL_MS` | Status and usage sync, default `60000` |
| `agent/.env` | `ROUTER_TIMEOUT_MS` | Timeout per RouterOS request, default `10000` |
| Supabase secrets | `ROUTER_SECRET_KEY` | `supabase secrets set ROUTER_SECRET_KEY=…` (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` are provided automatically) |

---

## Using the app

### Roles

| Role | Menu | Can do |
| --- | --- | --- |
| Admin | Dashboard, Sell, Vouchers, Plans, Routers, Sales, Reports, Active Users, Staff | Everything, all sites; voids; Disconnect |
| Manager | Dashboard, Sell, Vouchers, Sales, Reports, Active Users | Own site: generate and print vouchers, sell, mark as sold, sales and reports |
| Seller | Sell, Sales | Own site: sell and print receipts; sees only own sales for today |

### Router jobs (run by the agent)

| Job | When | What happens on the router |
| --- | --- | --- |
| `test_connection` | Router added/edited, **Test again** | Reads `/system/resource` and `/ip/hotspot`; checks the hotspot server; warns if the DNS name differs. A failed first test removes the router |
| `sync_profiles` | Plan saved, new router passes its test | Creates/updates `/ip/hotspot/user/profile` (`rate-limit`, `shared-users`) |
| `push_vouchers` | Vouchers generated, **Retry push** | Adds each voucher as `/ip/hotspot/user`: name = password = code, profile, `server`, `limit-uptime`, `limit-bytes-total`, `comment=hzc:<voucher_id>`; 50 per round |
| `disable_voucher` | Admin voids a sale | Disables the tagged user and closes its sessions |
| `disconnect_user` | **Disconnect** on Active Users | Closes that user's session |

Every router write is safe to repeat: the agent reads first and only touches users tagged
`hzc:<voucher_id>`. A code that already belongs to another hotspot user is never changed; that
voucher is disabled instead. If a router goes offline during a push, the progress is kept and the
push resumes by itself when the router is back.

### Usage sync and expiry (every 60 s per online router)

The agent reads who is online and each voucher's counters; the database then updates the Active
Users list, sets first login (`first_used_at`, `expires_at` = first login + plan validity, status
**active**) and marks vouchers **expired** when time, validity or data is used up. The router
itself stops users at their time and data limits; when **validity** ends while a customer is online
the agent closes that session. Expired vouchers are removed from the router only once offline.

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
- Router passwords are encrypted with AES-256-GCM by the `add-router` Edge Function. The browser can
  never read `password_enc` (column grant) and the agent never logs passwords.
- The service role key lives only in the agent's `.env`.
- Admin actions (router added/updated/removed, staff created/updated, sale voided) are written to `audit_log`.

## Backups

- **Database:** Supabase Pro projects have daily backups (Database → Backups). On any plan, also
  keep your own copy at least weekly and before big changes:
  `supabase db dump --linked -f backup-$(date +%F).sql` and
  `supabase db dump --linked --data-only -f data-$(date +%F).sql`. Store copies off the agent PC
  (cloud drive or USB kept elsewhere).
- **Keys:** keep `ROUTER_SECRET_KEY` and the agent `.env` in a password manager. Without the key
  the stored router passwords cannot be decrypted (they can be re-entered on the Routers page).
- **Routers:** `/export file=hotzonex-backup` in each router terminal, then download the `.rsc`
  from Files. Vouchers on a reset router can be pushed again with **Retry push**.

## Troubleshooting

| What you see | What to check |
| --- | --- |
| "The router did not answer within 60 seconds" / router stuck on "Not tested yet" | The Router Agent is not running. Having internet on your own computer does not replace the agent: the agent must run on a computer on the router's network (e.g. 192.168.120.x), because the website cannot reach a private router address. Another cause is an agent whose `.env` points to a different Supabase project. On the agent PC run `npm run check` in `agent/` — it checks Supabase, the key and every router — then `npm start` (or the service). The waiting test runs as soon as the agent starts |
| "No reply from 192.168.88.1" | Router on? Same LAN as the agent PC? IP correct? |
| "… refused the connection on port 80" | `/ip service set www disabled=no` and the `address=` list includes the agent PC |
| "Wrong username or password" | The `hzc-api` user and password on the router |
| "User hzc-api is not allowed to use the REST API" | The group needs `rest-api,read,write,api` policies |
| "Hotspot server hotspot1 not found" | Use the exact server name from IP → Hotspot → Servers |
| "Cannot decrypt the router password" | `ROUTER_SECRET_KEY` on the agent differs from the Edge Function secret |
| Batch stuck on "Push failed" | Router offline; it resumes by itself when back, or press **Retry push** |

## Development

```bash
npm run install:all      # web + agent dependencies
npm run typecheck        # strict TypeScript for web and agent
npm --prefix agent test  # agent unit tests (encryption, RouterOS client, time conversion)
npm run build:web
```

Migrations are in `supabase/migrations/` (one file per build phase, applied in order).
