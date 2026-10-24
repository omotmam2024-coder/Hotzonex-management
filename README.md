# Hotzonex Cloud

> **Proprietary and confidential.** Copyright (c) 2026 Hotzonex WiFi. All rights reserved. This is not open-source software: no permission is given to copy, modify, resell or publish it. See [LICENSE](LICENSE).


MikroTik hotspot voucher management for Hotzonex WiFi in Juba, South Sudan
(sites: Gorom, Jebel Iraq, HQ, Sub-Office — one RouterOS v7 router per site).

What it does:

- **Routers**: add each MikroTik router (by address and login, by tunnel, or by a setup script).
- **Vouchers**: create voucher codes, push them to the router, and **print** A4 card sheets and
  thermal receipts (codes only, no QR).
- **Selling**: sell for cash at a cashier screen (retry-safe: a bad connection never sells two cards),
  mark pre-printed cards as sold, and the mobile-money **Buy** page that a cashier confirms.
- **Reports**: revenue and usage by day, week and month, with a **profit** line.
- **Expenses & profit**: record running costs and see revenue − agent commission − expenses = profit.
- **Business settings**: business name, logo and the dollar rate (USD is shown next to SSP).
- **Selling Hotzonex Cloud to other businesses**: a public landing page, self sign-up with a
  welcome wizard, and subscription plans with limits (Starter, Business, Pro).
- **Dark mode**: Light / Dark / Auto switch at the bottom of the menu.

Money is whole South Sudanese Pounds (SSP); the web app shows times in Africa/Juba (UTC+2).

Live address: <https://hotzonex.net> (`www.hotzonex.net` redirects there; set in Vercel → Domains), hosted on **Vercel**
(project `hotzonex-cloud`), which deploys automatically from the branch `claude/clever-mccarthy-1780c7`.
The earlier address `app.hotzonex.net` (DigitalOcean) is no longer the live one. Database, logins and Edge Functions
are on Supabase (project `tyiwnaxdejtsdofgnuow`).

## How it fits together

```
Browser (staff) ──► Supabase (tables, login, router_jobs queue, Edge Functions)
                        │                                   ▲
   tunnel: router-direct calls the router's REST API        │ cloud: the router calls
   through the WireGuard tunnel (VPS relay)                 │ router-gateway every 30 s
                        ▼                                   │
                 MikroTik routers (RouterOS 7)  ────────────┘
```

Each router is added in one of two ways (Routers → Add router):

| | **Tunnel** (when the tunnel server is set up) | **Router connects to Hotzonex Cloud** (cloud) |
| --- | --- | --- |
| What you enter | Address, port, admin username and password; paste the tunnel script into Winbox once | Nothing extra: paste a setup script into Winbox once |
| Router needs | Internet access (public IP not needed), RouterOS 7.1+ | Internet access, RouterOS 7.19+ |
| How work reaches it | `router-direct` Edge Function through the tunnel, woken when a job is queued and every minute (pg_cron + pg_net) | The router's `hzc-cloud` scheduler calls `router-gateway` and runs the commands it gets back |
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
| `web/` | React 18 + TypeScript + Vite + Tailwind staff app, landing page, sign-up and Buy page | DigitalOcean App Platform |
| `supabase/` | Migrations, seed and the 10 Edge Functions: `add-router`, `create-staff`, `delete-items`, `router-gateway`, `router-direct`, `tunnel`, `portal`, `alerts`, `buy`, `signup` | Supabase |
| `scripts/` | Backup script for a Droplet | Your own server (optional) |

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
   # Called by logged-in staff (the Supabase gateway checks the login first):
   supabase functions deploy add-router
   supabase functions deploy create-staff
   supabase functions deploy delete-items
   # Check their caller themselves (router token, worker secret, public page, Telegram webhook):
   supabase functions deploy router-gateway --no-verify-jwt   # called by routers
   supabase functions deploy router-direct --no-verify-jwt    # called by the database every minute
   supabase functions deploy momo                             # owner's MTN MoMo API login (Payments page)
   supabase functions deploy tunnel --no-verify-jwt           # the VPS tunnel server
   supabase functions deploy portal --no-verify-jwt           # login-page files for routers
   supabase functions deploy alerts --no-verify-jwt           # Telegram alerts
   supabase functions deploy buy --no-verify-jwt              # the public Buy page
   supabase functions deploy signup --no-verify-jwt           # public sign-up
   ```

   Optional secret: `TELEGRAM_BOT_TOKEN` (Edge Functions → Secrets) turns on Telegram alerts.

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

### Deploy to DigitalOcean (App Platform)

1. **Create App → GitHub**, pick this repository and branch; **Source Directory:** `web`.
2. Choose **Static Site**. **Build Command:** `npm run build`; **Output Directory:** `dist`.
3. **Catchall Document:** `index.html` (every page address opens the app).
4. **Environment Variables** (build time): `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
5. In Supabase **Authentication → URL Configuration**: **Site URL** `https://app.hotzonex.net`
   (the DigitalOcean address until the domain is live), and under **Redirect URLs** add
   `https://app.hotzonex.net/**` and `https://hotzonex-cloud-rum4d.ondigitalocean.app/**`.
   "Forgot password?" on the login page sends a link back to `/reset-password` on the address it
   was asked from; an address missing from that list sends people to the Site URL instead.
   Supabase's built-in mailer sends only a few emails an hour: for real use add your own SMTP
   under **Authentication → Emails → SMTP Settings**.

On a Droplet with nginx instead, serve `web/dist` with `try_files $uri /index.html;`, give
`/assets/` `Cache-Control: public, max-age=31536000, immutable` and `/sw.js` and `/index.html`
`Cache-Control: no-cache`.

**Fast opening.** The app keeps its own files in the browser (service worker, `web/service-worker.js`,
built into `dist/sw.js`) and remembers the signed-in account and the small screens (dashboard, plans,
routers) for a day. Opening it again shows the last screen at once and refreshes it in the background;
it opens even when the connection is poor. A new version is picked up on the next opening.

Every push to the branch `claude/clever-mccarthy-1780c7` redeploys the web app on DigitalOcean.

### Vercel

The app is live on Vercel with `web/vercel.json` (project root `web`; build `npm run build`, output
`dist`; the same two `VITE_SUPABASE_*` variables). The Edge Functions answer only the addresses in
`supabase/functions/_shared/cors.ts` (`www.hotzonex.net`, `hotzonex.net`, the earlier
`app.hotzonex.net` and DigitalOcean addresses, and local development): a new address must be added
there and the functions deployed again. In Supabase **Authentication → URL Configuration** set the
**Site URL** to `https://www.hotzonex.net` and add `https://www.hotzonex.net/**` and
`https://hotzonex.net/**` under **Redirect URLs**.

## 3. Connect each router

First set up the hotspot on the router yourself, as you like it (IP → Hotspot → Hotspot Setup).
Hotzonex uses that hotspot as it is and never changes it or its profiles. Plans, vouchers and
sales are then managed in Hotzonex.

On the website: **Routers → Add router** and fill in, like a MikroTik app:
**Address**, **Port**, **Username**, **Password**, **Comment** → **Connect**.

- **Private address** (e.g. `192.168.88.1` — the usual case, also behind Starlink/4G):
  that address only works inside the router's own network, so Hotzonex shows a one-time setup
  script. Copy it, open Winbox → **New Terminal**, paste, press Enter. The script first checks that
  a hotspot is already **running**; if not, it stops and changes nothing. Then it lists the hotspot
  and the number of user profiles it found, and installs a script and a 30-second scheduler named
  `hzc-cloud` (permissions `read,write,test,ftp`) so the router talks to Hotzonex Cloud. Needs
  RouterOS 7.19+. The password is not stored for these routers.
- **Public IP or DNS name**: connected the same way (tunnel, or the setup script). Hotzonex never
  logs in to a router across the open internet, so its admin password only travels inside the
  WireGuard tunnel.

Either way the first check only **reads** the router's hotspot servers, server profiles and user
profiles. Hotzonex picks the running hotspot server and its DNS name automatically (you can change
both on the router's edit page) and shows what it found under **Hotspot setup**.

**No scheduler on the router: tunnel server (recommended for routers without a public IP).**
Rent the smallest Ubuntu VPS (about US$4–6/month; one serves all routers), allow UDP 51820 and
TCP 80/443 in the provider's firewall, then copy the install command from **Routers → Tunnel
server** and paste it on the VPS. It installs WireGuard and an HTTPS relay (Caddy, free certificate
on `<ip>.sslip.io`), keeps the router list in sync with Hotzonex and registers itself; the card turns
**Ready**. From then on a router at a private address is connected with a one-time **tunnel
script**: after checking that the hotspot is running it adds only a WireGuard interface `wg-hzc`
(one peer: the VPS), its address `10.99.0.x`, and one firewall rule letting `10.99.0.1` reach the
`www` port — all tagged `hotzonex-tunnel` — and removes any old `hzc-cloud` scheduler. WireGuard
keeps the tunnel up by itself; Hotzonex checks the router every minute through the relay with the
router's own login (stored encrypted). Port = the router's `www` service port. A router already
connected by script shows **switch it to the tunnel** on the Routers page.
To remove the tunnel from a router: `/ip firewall filter remove [find comment="hotzonex-tunnel"]`,
`/ip address remove [find comment="hotzonex-tunnel"]`, `/interface wireguard remove [find name="wg-hzc"]`.

If the router stays "Waiting" after an upgrade from an older RouterOS, it may not trust
certificates yet: `/certificate settings set builtin-trust-anchors=trusted`. To disconnect a
script-connected router: `/system scheduler remove [find name="hzc-cloud"]` and
`/system script remove [find name="hzc-cloud"]`.

## 4. First-day checklist

1. Log in as the owner.
2. **Routers → Sites:** add your sites (Gorom, Jebel Iraq, Sub-Office…).
3. **Routers → Add router** for each site (address, username, password) → paste the setup script if one is shown. It must show *Online* with the model, RouterOS version and hotspot.
4. **Plans:** check prices, time, validity, speed and colours. Each save updates the router profiles.
5. **Staff:** create managers and cashiers (each with a site).
6. **Vouchers → Generate vouchers:** wait for the batch to show **Ready**.
7. **Vouchers → Print cards** for pre-printed cards, and/or sell from the **Sell** screen.

---

## Environment variables

| Where | Variable | What / where to get it |
| --- | --- | --- |
| `web/.env`, DigitalOcean | `VITE_SUPABASE_URL` | Supabase → Project Settings → API → Project URL (optional: the app has Hotzonex Cloud's project built in) |
| `web/.env`, DigitalOcean | `VITE_SUPABASE_ANON_KEY` | Supabase → Project Settings → API → `anon` public key (used only together with a matching URL) |
| Supabase Edge Functions → Secrets | `TELEGRAM_BOT_TOKEN` | Optional. From @BotFather; turns on Telegram alerts |

No other secret is needed: the router password key (Vault secret `router_secret_key`) and the
worker secret are created inside the database by the migrations. There is no `ROUTER_SECRET_KEY`
environment variable. The service-role key is never put in the web app.

---

## Using the app

### Roles

| Role (database value) | Menu (from `web/src/lib/nav.ts`) | Can do |
| --- | --- | --- |
| Owner (`admin`) | Dashboard, Reports, Expenses & profit, Alerts, Sell, Payments, Sales, Cash-up, Vouchers, Plans, Routers, Active Users, Login Portal, Business settings, Staff, Billing, Security | Everything, all sites; voids; Disconnect; whole-business expenses |
| Manager (`manager`) | Dashboard, Reports, Expenses & profit, Alerts, Sell, Payments, Sales, Cash-up, Vouchers, Active Users, Security | Own site: generate and print vouchers, sell, mark as sold, sales, reports, and that site's expenses |
| Cashier / agent (`seller`) | Sell, Payments, Sales, Cash-up, Security | Own site: sell, print and share; own sales and cash; agents get a commission and credit limit |

**Businesses** is shown only to the people who run Hotzonex Cloud itself (platform admins).
There a business can be **switched off** (paused: staff cannot log in, nothing is deleted) and,
once switched off, **removed for good** (Remove → type its name): its sites, routers, plans,
vouchers, sales, expenses, invoices, alerts, staff logins and logo are deleted. Its routers keep
working on their own; they are only disconnected from Hotzonex Cloud.
A cashier's phone tab bar shows Sell, Payments, Sales and Cash-up; owners and managers see
Dashboard, Sell, Payments and Vouchers (the menu has the rest).

Roles are enforced in the database (RLS policies and checks inside every function), not only by the menu.
The database values `admin / manager / seller` stay as they are; only the labels on screen changed.

### Router jobs

| Job | When | What happens on the router |
| --- | --- | --- |
| `test_connection` | Router added/edited, **Test again** | Reads (never changes) the router's hotspot servers, server profiles and user profiles; checks the chosen hotspot server exists; warns if the DNS name differs or a plan's profile is missing |
| `sync_profiles` | Plan saved, new router passes its test | Adds the plan's `/ip hotspot user profile` only if the router has none with that name; existing profiles are never changed |
| `push_vouchers` | Vouchers generated, **Retry push** | Adds each voucher as `/ip hotspot user`: name = password = code, profile, `server`, `limit-uptime`, `limit-bytes-total`, `comment=hzc:<voucher_id>` |
| `disable_voucher` | Admin voids a sale | Disables the tagged user and closes its sessions |
| `disconnect_user` | **Disconnect** on Active Users | Closes that user's session |
| `install_portal` | **Install on router** (Login Portal) | Downloads the portal pages into a `hotzonex` folder (`flash/hotzonex` on flash routers), then sets the hotspot server profile's `html-directory` to it. Nothing is switched if a download fails |
| `restore_portal` | **Switch back** (Login Portal) | Sets `html-directory` back to the folder the router used before |

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
that stops calling in for 2 minutes is shown offline and its user list is cleared. A router
Hotzonex reaches itself (direct or tunnel) is shown offline after two missed checks in a row, so a
short internet drop at the site does not flash it offline; a wrong password or other error shows
at once.

### Selling

- **Sell screen:** one big button per plan (price, duration, cards left; yellow below 20,
  disabled at 0). Each tap sells one voucher — two cashiers can never get the same code — and
  shows it full-screen with **Print** and **Share** (the phone's share sheet, WhatsApp as a
  fallback). If the connection drops during a sale, the app tries again with the same request
  and gets back the same card, so a cashier can never sell two cards by accident.
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

### Plans and router profiles

Plans are made in Hotzonex only. When you tick a router for a plan, Hotzonex adds its **own** user
profile there, named `hzc-<plan>-<price>` (e.g. `hzc-DayPass-5000`), with the plan's speed and
devices per code; each card gets the plan's time and data limit, and Hotzonex removes cards whose
validity is over. MikroTicket's profiles (`profile_…`) are never used, changed or turned into plans.

The plans that were made from MikroTicket profiles before 16 October 2026 are switched off and
listed under **Old MikroTicket plans** at the bottom of the Plans page (kept so past reports keep
their names). MikroTicket cards on the routers keep working and their sales are still counted.

### Router users and sales from activated vouchers

Every minute Hotzonex reads all hotspot users on the router (MikroTicket's too) and shows the
count — total, unused (never used) and used — on the Dashboard and the router's card.

Every **activated** voucher is a sale, on the Sales page and in all reports:
- Hotzonex vouchers: when sold on the Sell screen, or at their first login (**Sell on first login**).
- MikroTicket and other router vouchers: when activated, at the price of their plan (the plan using
  their profile, or the `co:` price in a MikroTicket profile name). The activation time is taken
  from MikroTicket's `-da:` date in the voucher comment; without it, from the moment the voucher's
  used time first goes above zero (even if it logged in and out between two checks). They show on
  the Sales page with seller "Router (MikroTicket voucher)" and cannot be voided there.
Vouchers MikroTicket already removed from the router cannot be counted afterwards.

### Login portal

**Login Portal** (admins) gives each router a Hotzonex login page. Choose a template (Classic,
Bold or Minimal), set the business name, tagline, colours, logo, contact line and footer, and
whether the plans and prices are shown. The phone preview updates as you type. **Save**, then
**Install on router** (the router must be online). Saving again only changes the stored design;
press **Install on router** again to update the router.

- The pages are standard MikroTik hotspot pages (login, status, logout, error, alogin, redirect,
  rlogin, md5.js) and use CHAP when the hotspot offers it, PAP otherwise.
- **Code** login mode: customers type only the voucher code (the code is also the password).
  MikroTicket and other router users with a separate username and password tap
  **I have a username and password**, which shows a second box.
  **Username + password** mode shows both fields.
- The router's previous folder (e.g. `hotspot` or `flash/hotspot`) is remembered and left on the
  router; **Switch back** returns to it with one click.

### Reports

- **Dashboard:** today / this week (Mon–Sun) / this month revenue, users online now, revenue for
  the last 14 days, stock left per plan per site, routers online/offline with last seen, and
  **cards expiring in the next 24 hours**.
- **Reports:** Daily, Weekly and Monthly tabs with filters for site, plan and seller. Sections:
  summary with change versus the previous period, then a **profit line**: revenue − agent
  commission − expenses = profit (with a link to Expenses & profit); by plan, by seller, by site,
  sales per hour (daily) or per day (weekly; monthly with weekly subtotals), and voucher status.
  **Print** gives a clean A4 report; **Export CSV** opens in Excel.
- All totals always exclude voided sales.

### Expenses & profit

**Expenses & profit** (owners and managers) records running costs. Categories: internet, power,
rent, salaries, feeding, equipment, repairs, printing, transport, other. Each expense is for one
site or (owners only) for the whole business. The page shows revenue − agent commission −
expenses = **profit** per day, week or month, day by day and per category, with **Print** and
**CSV**. Managers record and see only their own site's expenses. Every added, changed or deleted
expense is written to the audit log.

### Dark mode

At the bottom of the menu there is a **Light / Dark / Auto** switch (Auto follows the phone or
computer setting). The choice is saved on each device; Light is the default. Printed cards,
receipts and reports are always printed light.

### Business settings

**Business settings** (owners): business name, logo (shown on printed cards) and the **dollar rate**. Once a rate is set, USD (≈ $) is shown next to SSP on the
dashboard, the sale screen and reports.

---

## Alerts, mobile money, agents and billing

### Languages
The app is in **English, Arabic (right to left) and Kiswahili**. Everyone picks a language at the
bottom of the menu (or at the top of the login, sign-up and Buy pages); it is saved on that device.
All texts live in `web/src/i18n/locales/*.ts` (one file per area; each English text has an Arabic
and a Kiswahili one, checked by `npm run typecheck`). Pages use `const { t } = useT(); t('key')`.

### Alerts (WhatsApp and Telegram)
Every 2 minutes Hotzonex looks for: a router offline for 5 minutes (and back online), cards that
failed or need checking after a push (missing on the router, wrong profile, code length unlike the
router's own cards), low stock, mobile-money payments to confirm, and billing messages. They show on
the **Alerts** page and go to WhatsApp and/or Telegram.

**WhatsApp (no API key).** Hotzonex Cloud sends alerts from a normal WhatsApp number: a second SIM
(not your personal number) linked to the tunnel server the same way WhatsApp Web is linked.
1. Put the second SIM in a phone and install WhatsApp on it.
2. Hotzonex → **Businesses → WhatsApp sender → Set up WhatsApp sender** → copy the command, paste it
   on the tunnel server (VPS) and press Enter (1–3 minutes). Running it again is safe.
3. A QR code appears on the same card. On the sender phone: WhatsApp → **Settings → Linked devices →
   Link a device** → scan it. The card shows **Connected** and the sender's number.
4. Each business (yours too): **Alerts → WhatsApp** → enter up to 5 numbers (e.g. `0924904216`;
   numbers starting with 0 are South Sudan) → **Save numbers** → **Send a test message**.

Good to know: this way of sending is unofficial (WhatsApp Web protocol, library
`@whiskeysockets/baileys`). A few messages a day to people who expect them keeps the risk low, but
WhatsApp can block a number it thinks is a bot; that is why a separate SIM is used. Keep the sender
phone charged and online at least once every two weeks. If the sender is offline, alerts are retried
every 2 minutes (5 times) and always stay on the Alerts page. On the VPS: `systemctl status hzc-wa`,
`journalctl -u hzc-wa -n 50`. **Unlink phone** on the card (or Linked devices on the phone) unlinks it.

**Subscription reminders (English, Arabic, Kiswahili).** Businesses that use Hotzonex Cloud are
told before their service runs out: 7, 3 and 1 day before the paid month or the free trial ends,
plus a new invoice, an invoice due in 2 days, the app paused (unpaid) and payment received. Each
business chooses the language on **Alerts → WhatsApp → Language of Hotzonex messages**. The texts
have defaults in all three languages; change them on **Businesses → Billing messages** (words like
`{business}`, `{date}`, `{days}`, `{amount}`, `{invoice}`, `{due}`, `{pay}` are filled in; an empty
text uses the default). They go to the business's alert numbers, or the phone it signed up with.

**Telegram.**
1. In Telegram, talk to **@BotFather** → `/newbot` → pick a name → copy the token it gives.
2. Supabase → **Edge Functions → Secrets** → add `TELEGRAM_BOT_TOKEN` with that token (never paste it anywhere else).
3. In Hotzonex: **Alerts → Connect Telegram** → press **Start** in Telegram. For a group, add the bot to the group first.

### Selling by mobile money (send and confirm)
**Payments → Buy page**: switch it on for a site, give the page an address and where to send the
money (e.g. `MTN MoMo 092 … (Hotzonex WiFi)`), then print the QR poster. The site's routers let
customers open the page before they log in (walled garden). The customer picks a card, sends the
money, types the transaction ID; the cashier gets an alert, checks the money arrived, and taps
**Confirm**: a card from stock (or one made on the spot, in the router's own code length) appears on
the customer's phone. A transaction ID works once; requests are limited per phone and device; unconfirmed
requests expire after a day.

### Paying with the MTN MoMo API (automatic)
With the business's own **MTN MoMo Open API (Collections)** keys, the customer does not type a
transaction ID: on the Buy page they pick a card, type their MoMo number and tap **Pay with MoMo**;
MTN sends a prompt to their phone, they type their PIN, and the card appears as soon as MoMo confirms
(no cashier needed). **Payments → MTN MoMo API**: environment, target environment, currency, API
user, API key and subscription key, then **Test the login**. Keys are stored encrypted (AES-256-GCM,
the same Vault key as router passwords) and never shown again.
- **Sandbox** (testing): keys from <https://momodeveloper.mtn.com>, target environment `sandbox`,
  currency `EUR`, no real money. **Production**: keys, target environment and currency (SSP) from
  MTN South Sudan.
- Only MoMo's own status answer confirms a payment, and only for the exact amount and currency;
  there is no callback to fake. Waiting payments are checked while the customer's page is open and
  every 2 minutes by `pg_cron` (`hzc-momo-sweep` → `buy`, action `momo_sweep`); still waiting after
  30 minutes = expired. Paid but no card could be made (or a different amount) → the request stays
  on the Payments page for the cashier, with an alert.
- **Paid another way?** on the Buy page keeps the manual flow (m-Gurush, Digicash, or MoMo sent by hand).

### Agents and cash-up
**Cash-up**: per seller and day: cash cards sold, commission, cash to hand in, cash handed in, the
difference, and the cash each seller holds now. **Receive cash** records what a seller hands in.
**Commission & limit** (admins): a seller's commission on cash sales, and the most cash they may hold —
over it, they cannot sell until they hand in cash. Sellers see their own figures.

### Selling Hotzonex Cloud (sign-up and billing)
Visitors see the landing page at `/` (features, screenshots, prices, FAQ, contact). New businesses
sign up at `/signup` (free trial, default 14 days) and then go through a short **welcome wizard**
(details and logo, site, router, plan, first cards). As a platform admin, set the
**price per router per month**, grace days, trial days and how businesses pay you under
**Businesses → Billing for Hotzonex Cloud**. With price 0 nobody is invoiced. Existing businesses are
**Not billed** until you untick it. Each morning an invoice is made per billed business (connected
routers × price); reminders go out before the due day; unpaid after the grace days, the business is
paused (its WiFi keeps working, its admins see only the invoice and can send their payment's
transaction ID). **Mark paid** switches it back on.

**Subscription plans and limits.** Each billed business is on a plan; the database refuses to go
over its limits:

| Plan | Routers | Sites | Staff | Vouchers a month |
| --- | --- | --- | --- | --- |
| Starter | 1 | 1 | 3 | 5,000 |
| Business | 5 | 3 | 15 | 30,000 |
| Pro | no limit | no limit | no limit | no limit |

Each plan can have its own price (optional). Owners see their plan and usage on **Billing**.
On **Businesses → Subscription plans** you change the limits and prices; on a business's row you
**move it to another plan** and **extend its trial** (+14 or +30 days). Businesses that are
**Not billed** (such as your own) have no limits.

## Security

- Row Level Security is on for every table; policies read the caller's role and site from `profiles`.
- Sales and voucher status change only through `SECURITY DEFINER` database functions; the browser
  cannot insert sales or edit vouchers directly.
- Tunnel routers: the admin password is encrypted with AES-256-GCM; the key is in Supabase Vault and
  readable only by the service role. The browser can never read `password_enc` (column grant).
  Hotzonex never logs in to a router across the open internet: the password only travels inside
  the WireGuard tunnel.
- Cloud routers: no password is stored. Each router has a random 256-bit token (only its SHA-256 is in
  the database) and checks Hotzonex Cloud's HTTPS certificate, so the commands it runs can only come
  from Hotzonex Cloud. Protect the Supabase account with a strong password and two-factor sign-in.
- The service role key never leaves Supabase (Edge Functions only).
- The **audit trail** (`audit_log`: who, what, when, which business) records sales, voids, voucher
  batches, plan and price changes, staff role / active / site changes, staff created, routers
  added / updated / removed, expenses, business settings, billing plans, and support-mode actions.
  Voids are logged by `void_sale`; cash handovers and seller terms by their own functions. Each
  event is written once (no duplicates).
- **2-step login** (authenticator app, Security page): once someone turns it on, the database gives
  their login no access at all until the code is typed (`mfa_satisfied`), so a stolen password alone
  opens nothing. Platform powers (all businesses, support mode, billing) need it always.
- **Support mode** (Businesses → Manage): a platform admin works inside a customer's business as its
  admin for up to 2 hours, to set up and fix their routers. The customer gets an alert; every action
  is in their audit log under the platform admin's name. Hotzonex Cloud's own business is never billed.
- The functions the app calls answer only the app's own websites (CORS); the built site carries a
  Content-Security-Policy (scripts only from the site, data only to its Supabase project).
- Idle logins end after 8 hours without use; **Log out on all devices** ends every login at once.

## Backups

- **Database:** Supabase Pro projects have daily backups (Database → Backups). On any plan, also
  keep your own copy at least weekly and before big changes:
  `supabase db dump --linked -f backup-$(date +%F).sql` and
  `supabase db dump --linked --data-only -f data-$(date +%F).sql`. Store copies somewhere safe
  (cloud drive or USB kept elsewhere).
- **Automatic daily copy to DigitalOcean Spaces** (`scripts/backup/`), run from the Droplet:
  1. DigitalOcean → **Spaces Object Storage → Create bucket** (private, e.g. `hotzonex-backups`
     in `fra1`), then **Access Keys → Create** a key limited to that bucket.
  2. On the Droplet (Ubuntu), install the Postgres 17 tools (Supabase runs Postgres 17) and s3cmd:
     ```sh
     sudo apt install -y postgresql-common s3cmd
     sudo /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y
     sudo apt install -y postgresql-client-17
     sudo cp scripts/backup/hotzonex-backup.sh /usr/local/bin/ && sudo chmod 755 /usr/local/bin/hotzonex-backup.sh
     sudo cp scripts/backup/hotzonex-backup.env.example /etc/hotzonex-backup.env && sudo chmod 600 /etc/hotzonex-backup.env
     sudo nano /etc/hotzonex-backup.env   # database connection string, bucket, Spaces key
     ```
     For `DATABASE_URL` copy the **Session pooler** string from Supabase → **Connect** (it works
     over IPv4) and put the database password in it.
  3. Run it once: `sudo /usr/local/bin/hotzonex-backup.sh` → `backup ok: hotzonex-….tar`.
  4. Every night at 02:17: `echo '17 2 * * * root /usr/local/bin/hotzonex-backup.sh >> /var/log/hotzonex-backup.log 2>&1' | sudo tee /etc/cron.d/hotzonex-backup`

  Each file holds all Hotzonex tables and the staff logins; 30 days are kept. To restore into a
  new Supabase project: apply `supabase/migrations`, then restore `auth.dump` first and
  `public.dump` second, each with
  `PGOPTIONS='-c session_replication_role=replica' pg_restore --data-only --no-owner -d "$NEW_DATABASE_URL" <file>`
  (the option keeps the database's own triggers from re-running on the copied rows).
- **The router password key — back it up separately.** Router passwords and the WireGuard tunnel
  keys are encrypted with one key kept in Supabase Vault, secret name `router_secret_key` (created
  by migration `20261011072952_router_secrets_in_vault.sql`). It is **not** in the backup files and
  there is no environment variable for it. To read it, open Supabase → **SQL Editor** (which runs
  as the database owner) and run:
  `select decrypted_secret from vault.decrypted_secrets where name = 'router_secret_key';`
  Write the value down somewhere safe and offline (not in the backup bucket, not in chat or email).
  A new project must get the same key in Vault (`vault.create_secret(<value>, 'router_secret_key')`)
  before the copied router passwords can be used; without it, re-enter every router password and
  run the tunnel script again.
- **Routers:** `/export file=hotzonex-backup` in each router terminal, then download the `.rsc`
  from Files. Vouchers on a reset router can be pushed again with **Retry push**.

## Troubleshooting

| What you see | What to check |
| --- | --- |
| "No reply from the router through the tunnel" | The tunnel script was pasted, the router has internet, and the `www` service is on for the port saved in Hotzonex |
| "Hotzonex no longer logs in to routers across the internet" | A router saved the old direct way: open it and use **Switch to the tunnel** |
| "Wrong router username or password" / "may not use the REST API" | The admin login; its group needs read, write, api and rest-api |
| Router stays "Waiting for router" | Cloud: the setup script was not pasted, or the router has no internet. Run `/system script run hzc-cloud` and `/log print where topics~"script"` |
| "Hotspot server … was not found on this router" | Edit the router and use one of the server names listed in the message (IP → Hotspot → Servers) |
| Router shows Offline | Cloud: it has not called in for 2 minutes. Tunnel: the minute check could not reach it (the reason is shown) |
| Voucher codes do not log in on the portal | `/log print where topics~"hotspot"` on the router. "invalid password" for a MikroTicket voucher in Code mode: use **I have a username and password**. The user must exist under IP → Hotspot → Users |
| Portal install fails | The router must reach `*.supabase.co` over HTTPS (`/tool fetch` with `check-certificate=yes-without-crl`) and have free storage |
| Batch stuck on "Push failed" | Router offline; it resumes by itself when back, or press **Retry push** |

## Development

```bash
npm run install:all      # web dependencies
npm run typecheck        # strict TypeScript for the web app
npm run lint             # ESLint (TypeScript + React hooks), no warnings allowed
npm test                 # router/billing/buy logic and the form checks (Node 22.18+)
npm run build:web
```

All four must pass before a push: DigitalOcean builds every commit on the branch.

### Database migrations

Migrations are in `supabase/migrations/`, applied in file-name order. **Every file there is applied
to the live project** (latest: `20261017090000_review_fixes.sql`, 17 October 2026). The live
database runs Postgres 17.

Never edit a file that was applied. A database change is written as a **new file**, reviewed, and
only then applied to the live project:

```bash
supabase link --project-ref tyiwnaxdejtsdofgnuow
supabase migration list        # shows which files are not applied yet
supabase db push               # applies them, in order
```

(Or paste each new file into Supabase → SQL Editor, oldest first.)

After applying, regenerate the database types used by the web app:

```bash
supabase gen types typescript --project-id tyiwnaxdejtsdofgnuow > web/src/lib/database.types.ts
```

`web/src/lib/database.pending.ts` now holds only the "generator gaps" (things the generator cannot
see, such as `tenant_id` filled by a trigger). If a new migration needs entries there before it is
applied, remove them again once it is applied and the types are regenerated.
