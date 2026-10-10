# Hotzonex Cloud

MikroTik hotspot voucher management for Hotzonex WiFi, Juba (Gorom, Jebel Iraq, HQ, Sub-Office).

| Folder | What it is | Runs on |
| --- | --- | --- |
| `web/` | React 18 + TypeScript + Vite + Tailwind staff app | Vercel |
| `supabase/` | Database migration and Edge Functions | Supabase cloud |
| `agent/` | Router Agent (Node.js 20) that talks to routers by private IP | Always-on PC on the router LAN |

The browser never talks to a router. It writes jobs to Supabase; the Router Agent on the LAN
polls those jobs over outbound HTTPS and calls each router's RouterOS v7 REST API.

> Status: **Phase 3** (routers, staff and the Router Agent). Full setup, deployment and backup notes are completed in Phase 8.

## Setup

### 1. Supabase project

1. Create a project at <https://supabase.com> (region closest to Juba, e.g. Europe/Frankfurt).
2. **Authentication → Providers → Email**: keep Email enabled, turn **off** "Allow new users to sign up".
3. Run the migration on an **empty** project, either with the CLI
   (`supabase link --project-ref <ref> && supabase db push`) or by pasting
   `supabase/migrations/20261010000000_hotzonex_schema.sql` into **SQL Editor**.
   If you ran the Phase 1 version of this file, start from an empty database first
   (`supabase db reset --linked`, or drop the `public` tables `profiles` and `sites`).
4. Open `supabase/seed.sql`, change the admin email and password at the top, and run it in the
   SQL Editor. It creates the **HQ** site, the admin login and three sample plans
   (2 Hours 1,000 SSP · 1 Day 3,000 SSP · 1 Week 15,000 SSP). It is safe to run twice.
   Locally, `supabase db reset` runs the migration and the seed for you.

### 2. Router password key and Edge Functions

Generate one key and keep it safe. The same value goes into the Edge Function secret and the agent's `.env`.
If it is lost, every router password has to be entered again.

```bash
openssl rand -hex 32                                   # 64 hex characters
supabase secrets set ROUTER_SECRET_KEY=<that-value>
supabase functions deploy add-router
supabase functions deploy create-staff
```

Staff accounts are now created on the **Staff** page (admin only).

### 3. Web app

```bash
cd web
cp .env.example .env      # fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm install
npm run dev               # http://localhost:5173
```

### 4. Router Agent (on an always-on PC on the router LAN)

Needs Node.js 20 or newer. The agent only makes outbound HTTPS connections to Supabase,
and plain HTTP (or HTTPS) to each router's private IP. No port forwarding, VPN or public IP is needed.

```bash
cd agent
cp .env.example .env      # SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ROUTER_SECRET_KEY
npm install
npm run check             # prints "Connected to Supabase"
npm start                 # builds and runs; Ctrl+C to stop
npm test                  # unit tests (encryption, RouterOS client)
```

What it does: picks up `router_jobs` every 3 s (jobs for different routers run in parallel),
tests routers when they are added or "Test again" is pressed, and checks every router every 60 s
to keep online/offline, model, RouterOS version and last seen time up to date.
Each RouterOS request times out after 10 s.

**Run it as a service so it restarts on boot** (pick one):

| System | Steps |
| --- | --- |
| Linux, PM2 | `npm i -g pm2 && npm run build && pm2 start ecosystem.config.cjs && pm2 save && pm2 startup` |
| Linux, systemd | Copy the agent to `/opt/hotzonex/agent`, create user `hotzonex`, then `sudo cp deploy/hotzonex-agent.service /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl enable --now hotzonex-agent` |
| Windows, NSSM | `winget install NSSM.NSSM`, then in an Administrator PowerShell in the agent folder: `npm run build; .\deploy\install-windows-service.ps1` |

### 5. Prepare each router

Run in the router terminal (Winbox → New Terminal); use the agent PC's LAN IP:

```
/ip service set www disabled=no port=80 address=<agent-PC-IP>/32
/user group add name=hzc-api policy=read,write,api,rest-api,test
/user add name=hzc-api group=hzc-api password=<strong-password>
```

Then add the router on the **Routers** page and click **Save and test**.

## Database overview

| Table | Holds |
| --- | --- |
| `sites`, `profiles` | Business sites and staff (role + site) |
| `routers` | Router connection details; `password_enc` is never readable by the browser |
| `plans` | Price plans (SSP, seconds, speed, data, colour, RouterOS profile) |
| `voucher_batches`, `vouchers` | Generated codes and their status |
| `sales` | One row per sold voucher; voids keep the row with `voided_at` |
| `router_jobs` | Queue the Router Agent works through |
| `active_sessions`, `audit_log` | Live users per router; admin action log |

Money and voucher-status changes happen only inside these database functions:

| Function | Who | Does |
| --- | --- | --- |
| `generate_vouchers(router_id, plan_id, quantity, code_length = 8)` | Admin, manager (own site) | Creates a batch of unique numeric codes and queues a `push_vouchers` job; returns the batch id |
| `sell_voucher(router_id, plan_id)` | All staff (own site) | Takes the oldest unused, pushed, **not printed** voucher (`FOR UPDATE SKIP LOCKED`), marks it sold and inserts one sale; returns the code |
| `report_sales(site_id, date_from, date_to, group_by, plan_id?, seller_id?)` | Admin; manager (own site) | Totals per day / week (Mon–Sun) / month in Africa/Juba time, voids excluded |

Pre-printed cards are left out of `sell_voucher` on purpose: a printed card may already be in a
customer's hand, so it is recorded with **Mark as sold** (Phase 6) instead of being sold twice.

The browser must list router columns explicitly (`select('id, name, ...')`); `select('*')` on
`routers` is refused because of the `password_enc` column grant.

## Roles

| Role | Menu |
| --- | --- |
| Admin | Dashboard, Sell, Vouchers, Plans, Routers, Sales, Reports, Active Users, Staff |
| Manager | Dashboard, Sell, Vouchers, Sales, Reports, Active Users (own site) |
| Seller | Sell, Sales (own site) |

Opening a page your role cannot use sends you back to your home page (Dashboard, or Sell for sellers).
