# Hotzonex Cloud

MikroTik hotspot voucher management for Hotzonex WiFi, Juba (Gorom, Jebel Iraq, HQ, Sub-Office).

| Folder | What it is | Runs on |
| --- | --- | --- |
| `web/` | React 18 + TypeScript + Vite + Tailwind staff app | Vercel |
| `supabase/` | Database migration and Edge Functions | Supabase cloud |
| `agent/` | Router Agent (Node.js 20) that talks to routers by private IP | Always-on PC on the router LAN |

The browser never talks to a router. It writes jobs to Supabase; the Router Agent on the LAN
polls those jobs over outbound HTTPS and calls each router's RouterOS v7 REST API.

> Status: **Phase 6** (selling). Full setup, deployment and backup notes are completed in Phase 8.

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

What it does: picks up `router_jobs` every 3 s (jobs for different routers run in parallel) and
checks every router every 60 s to keep online/offline, model, RouterOS version and last seen time
up to date. Each RouterOS request times out after 10 s.

| Job | When | What the agent does on the router |
| --- | --- | --- |
| `test_connection` | Router added/edited, **Test again** | Reads `/system/resource` and `/ip/hotspot`, checks the hotspot server and DNS name |
| `sync_profiles` | Plan saved (speed, shared users, profile), new router passes its test | Creates/updates `/ip/hotspot/user/profile` (`rate-limit`, `shared-users`) |
| `disable_voucher` | Admin voids a sale | Sets `disabled=yes` on the user tagged `hzc:<voucher_id>` and closes its open sessions |
| `push_vouchers` | Vouchers generated, **Retry push** | Adds each voucher as `/ip/hotspot/user` (name = password = code, profile, `server`, `limit-uptime`, `limit-bytes-total`, `comment=hzc:<voucher_id>`), 50 per round |

Pushing is safe to repeat: the agent reads the router's users first and only marks users that
already carry the right `hzc:<voucher_id>` comment. A code that already belongs to another hotspot
user is never touched; that voucher is disabled instead. If a router goes offline during a push,
the progress so far is kept and the agent resumes the push by itself once the router is back
(at most every 5 minutes per batch).

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

## Selling

- **Sell screen:** one big button per plan with price, duration and cards left. Sellers and
  managers sell for their own site; admins pick a site. Below 20 cards the button shows a yellow
  warning; at 0 it is disabled ("Out of stock — generate vouchers"). Each tap calls
  `sell_voucher`, which locks one voucher (`FOR UPDATE SKIP LOCKED`) so two cashiers never get the
  same code, and records one cash sale.
- **Pre-printed cards** are never sold on the Sell screen. Either record them with
  **Sales → Mark printed cards as sold** (by batch or by typing codes, choosing the seller), or
  turn on **Sell on first login** for the site (Routers → Sites): the agent then records a cash sale
  with no seller the first time an unused card logs in (checked every 60 s).
- **Sales list:** today by default; filter by dates, site, plan and seller. Sellers see only
  their own sales for today. Admins can **void** a sale within 24 hours with a reason: the sale
  stays in the list as voided, is left out of all totals, and the voucher is disabled on the router.

## Printing

- **A4 cards:** Vouchers → **Print cards**. Pick a batch, or unused cards for a router/plan, and
  24, 40 or 50 cards per page (50 per page fits codes up to 8 digits). In the print window choose
  **A4, portrait, scale 100% (Default), margins Default, no headers/footers**, and tick
  **Background graphics** so the plan colour bars print.
- Clicking **Print** marks the cards as printed (`printed_at`); the voucher status does not change
  and it is not a sale. If the print was cancelled, click **Unmark these cards** straight away.
  Printed cards are not handed out by the cashier's Sell screen, because they may already be with
  a customer; record them with **Mark as sold** (Phase 6).
- **Receipts:** 58 mm or 80 mm thermal paper (the choice is remembered on each device). Set the
  thermal printer's paper size to match and margins to none.
- Only vouchers that are already on the router can be printed.

## Roles

| Role | Menu |
| --- | --- |
| Admin | Dashboard, Sell, Vouchers, Plans, Routers, Sales, Reports, Active Users, Staff |
| Manager | Dashboard, Sell, Vouchers, Sales, Reports, Active Users (own site) |
| Seller | Sell, Sales (own site) |

Opening a page your role cannot use sends you back to your home page (Dashboard, or Sell for sellers).
