# Changelog

## 24 October 2026 — emails in Hotzonex Cloud's colours

- The staff welcome email uses the app's brand blue (#15479c), the logo, a light-blue page and a
  rounded white card. `supabase/templates/confirmation.html` (sign-up) and `recovery.html`
  (reset password) and `email_change.html` (change email) have the same design: paste each into Supabase → Authentication → Email
  Templates (they also fix a stray "<" and leftover default text in the current templates).

## 24 October 2026 — staff welcome email

- When an owner adds a staff member, the new person gets a **welcome email** (through Resend, from
  `no-reply@mail.hotzonex.net`): the business that added them, their role, their login email, the
  login address and a one-time link to **choose their own password** (24 hours). In English, Arabic
  or Kiswahili: the language the owner is using. The password the owner typed is never emailed.
- Staff page: says whether the email went out, and **Send welcome email** on each active staff member.
- Needs the Edge Function secret `RESEND_API_KEY` (Supabase → Edge Functions → Secrets); without it
  the account is still created and the page says the email was not sent.

## 24 October 2026 — hotzonex.net as the main address, findable on Google

- The canonical address, sharing tags, sitemap and robots file use **https://hotzonex.net** (the
  address verified in Google Search Console) instead of www.hotzonex.net.
- `robots.txt` no longer blocks the app's own files (`/assets/`, images): Google needs them to draw
  the landing page, which it saw as an empty page before.
- The page's HTML carries the landing page's headline and features as plain text (replaced by the
  app as it starts) and a schema.org description naming the brand "Hotzonex".
- **By hand in Vercel → Domains**: `hotzonex.net` without a redirect, `www.hotzonex.net` → redirect
  308 to `hotzonex.net`. Then in Search Console: submit `https://hotzonex.net/sitemap.xml` and ask
  to index `https://hotzonex.net/`.

## 24 October 2026 — pay with the MTN MoMo API

- **Buy page**: when the business has saved its MTN MoMo API keys, the customer types their MoMo
  number and taps **Pay with MoMo**; MTN sends a prompt to their phone and the card appears as soon
  as MoMo confirms, with no transaction ID to type or check. **Paid another way?** keeps the manual flow.
- **Payments → MTN MoMo API** (owner): environment (sandbox or production), target environment,
  currency, API user, API key, subscription key, **Test the login**. Keys are stored encrypted.
- Only MoMo's status answer confirms a payment, for the exact amount and currency. Payments a
  customer left are checked every 2 minutes; a paid one without a card stays for the cashier.
- Migration `20261023194330_momo_api.sql` (applied); new Edge Function `momo` and updated `buy`
  (deployed 23 October 2026).
- **To deploy by hand** (Supabase CLI, exact files from the repository): `add-router` and
  `router-direct` from "routers only through the tunnel" below.

## 23 October 2026 — routers only through the tunnel

- Hotzonex **no longer logs in to routers across the open internet** (the old "direct" connection
  at a public IP or DNS name, which sent the router's admin password over plain HTTP on port 80).
  Every router, whatever its address, now joins through the **tunnel** (or the setup script when
  the tunnel server is not set up), so the password only travels inside WireGuard.
- A router saved the old way stops being contacted and shows "move it to the tunnel"; **Switch to
  the tunnel** moves it. No live router used the old way.

## 23 October 2026 — delete in the Businesses billing section

- **Invoices**: every invoice of a business has a **Delete** button (removed completely, kept in the
  audit log). A business paused only for unpaid invoices opens again once none is overdue. Deleting
  the latest invoice lets the daily billing make a new one for the month, so **Void** stays the way
  to not charge a business.
- **Hotzonex plans**: Business, Pro and any new plan can be deleted; their businesses move to
  Starter, which new businesses start on and so stays.
- **Remove business** in each business's billing box: type the name to confirm; a business still
  switched on is switched off first. Your own business cannot be removed.

## 23 October 2026 — email confirmation at sign-up

- A new business's owner must open the link emailed to them before they can log in, so nobody
  can sign up a business with someone else's email address. The link logs them straight into the
  welcome page. After signing up they see "Check your email" with **Send the email again**; the
  login page offers the same button when the email is not confirmed yet. Staff logins made by an
  owner are not affected.

## 23 October 2026 — security audit before production

- **Businesses kept apart on routers**: a router's reply can no longer remove or switch off another
  business's plan, disable another business's cards, or delete another router's cards. Jobs sent
  from the app may only name the business's own plans.
- **Direct routers**: only real public addresses are accepted. Numeric tricks such as
  `2130706433` are refused, the name is checked again before every connection (IPv4 and IPv6), and
  redirects are not followed.
- **Check voucher**: sellers can make 30 checks per 10 minutes and do not see cards that were never
  printed or sold, so the check cannot be used to guess working codes.
- **Business details and staff accounts** change only through the screens that check them.
- **Cash handovers**: sellers see only their own.
- **Framing**: the app refuses to show inside another website's frame.
- **Database**: 21 missing indexes added; secret compared in constant time in the router worker.

## 22 October 2026 — simpler Vouchers, Generate and Routers

- **Vouchers**: on a phone each voucher is a card (big code, status, plan, router, sold time,
  "Not on the router yet" when it is still being added). Only Search and Status show; router, plan
  and batch are under **More filters**. Wide screens keep the table.
- **Generate vouchers**: 3 numbered steps: which router (shown, not asked, when there is only one),
  which card (tap a coloured plan button), how many (50 / 100 / 200 / 500 or type a number). The
  code length is set from the router and folded away. Generate stays grey until a router and plan
  are chosen.
- **Routers**: each router shows a big **Working** / **Not answering** box and how many cards are
  on it. Buttons in front: **Check now** and **Edit** (a new router shows its setup script button
  first). Connection details, health, hotspot setup and Remove are under **More**.

## 22 October 2026 — simpler payments and invoices

- **Payments (mobile money)**: each payment to check is one big card: amount, the phone it came
  from and the transaction ID in large letters, and two buttons: **Yes, the money arrived** (then
  **Give the card**) or **No, not received** (then a reason to tap). No pop-up boxes. The card code
  given is shown in big digits. Earlier payments are folded away. Setting up selling is 3 numbered
  steps (turn on, your mobile-money number, print the poster); the page address is optional.
- **Billing / invoices for businesses**: a big status at the top (free trial and days left, invoice
  to pay, paused, all paid), plan, real price (the plan's own price), routers and **the next invoice
  date and amount**. The invoices list is always shown, with "your first invoice comes on …" during
  the trial. Each invoice opens as a proper **invoice page** to print or save as PDF, with a box to
  type the transaction ID. "How to pay" is 3 numbered steps.
- Platform admins see when a trial business gets its first invoice.
- Migration `20261022140000_billing_overview_next_invoice.sql` (applied).

## 22 October 2026 — tunnel server keeps up by itself

- The tunnel server's router-list sync never stops any more: it runs every 30 seconds by the clock,
  never fails (a problem is logged and retried), restarts WireGuard if applying the list fails, and
  starts it if it is down. A new router therefore connects as soon as its own script is pasted on
  the router; nothing has to be run on the server. Run the server's install command **once** more
  to get this version (Routers → Tunnel server → Show install command).

## 22 October 2026 — remove completely

- **Owners can remove a router or a plan completely**, even with vouchers and sales. When the normal
  Remove/Delete refuses, **Remove completely…** shows what goes (sales and their total, vouchers,
  batches, router logins, plans only on that router), and the name must be typed. The sales leave all
  reports, totals and cash-up. Every removal is written to the audit log. A plan's unsold cards and
  its Hotzonex profile are removed from the routers; a removed router itself is not changed.
- Migration `20261022120000_force_remove.sql`.

## 22 October 2026 — plans per router

- **Plans page by router**: one tab per router (with its number of plans) shows only that router's
  plans; plans not on any router have their own tab. The chosen tab is remembered on the device.
- **New plan for <router>** is ticked only for the router being shown (before, every router was
  ticked, so new plans appeared on all routers). Tick more routers in a plan only to sell it there too.
- Sell and Generate vouchers already show only the chosen router's plans.

## 22 October 2026 — dollars on what businesses pay

- **Dollar amounts for business payments.** Set the **dollar rate** (pounds for 1 US dollar) under
  Businesses → Billing for Hotzonex Cloud. The dollar amount then shows next to the SSP price on the
  landing page, on the owner's Billing page (price, invoices, banner), in the platform billing screen
  and subscription plans, and in the WhatsApp/Telegram billing messages, for example
  `120,000 SSP (≈ $26.67)`. Empty rate = SSP only, as before.
- Migration `20261022100000_billing_usd_rate.sql` (applied).

## 18 October 2026 — check a voucher

- **Check voucher** (menu → Selling, every role): type the code a customer complains about or brings
  back and see at once **NOT USED / IN USE NOW / USED — TIME LEFT / USED UP / SWITCHED OFF**, with
  the plan, router, who sold it and when, first login, time and data used, valid-until, the device
  online now, and how recently the router reported (a warning when that is old). Works for Hotzonex
  vouchers and for MikroTicket codes the routers report. Cashiers and managers see their own site.
- Migration `20261018120000_check_voucher.sql` (applied).

## 18 October 2026 — remove a business for good

- **Businesses → Remove** (platform admins): when an owner leaves Hotzonex Cloud, switch the business
  off, then remove it for good by typing its name. Its sites, routers, plans, vouchers, sales,
  expenses, invoices, alerts, staff logins and logo are deleted; this cannot be undone. A short
  note of each removal is kept (table `removed_businesses`).
- The 2-step login QR code scans in light and dark mode, with an "Open in authenticator app"
  button and a copyable key.
- Migration `20261018090000_remove_business.sql`.
- **Plans: data limit in MB or GB.** Choose MB or GB next to the data limit; GB can have decimals
  (1.5 GB = 1536 MB, as the router counts). Plan cards and the Buy page show large limits in GB.
- **Pages open after an update without refreshing.** The open app notices a new version
  (`/version.json`) and loads it on the next page you choose; the app is fetched from the network
  first (the saved copy only offline), and a missing page file reloads into the new version instead
  of showing "A new version is ready".

## 18 October 2026 — the app in English, Arabic and Kiswahili

- Every screen is available in **English, العربية (Arabic, right to left) and Kiswahili**: the
  menu, all pages, forms and their checks, printed voucher cards and receipts, reports and CSV
  files, the Buy page for customers, sign-up, login, terms, and the server's error messages.
- Choose the language at the bottom of the menu, or at the top of the login, sign-up and Buy pages.
  It is saved on each phone or computer; the first visit follows the phone's language.
- Dates and times use the chosen language (Latin digits); amounts stay in SSP.
- Still in English: router commands and WinBox screen names, names and data people type, server
  messages with changing parts (names, numbers), alerts to owners other than billing reminders,
  and the hotspot login page on the routers. A native Arabic and Kiswahili speaker should read the
  texts once (web/src/i18n/locales/*.ts) — wording can be changed there without touching the code.

## 17 October 2026 — subscription reminders in three languages

- Businesses on Hotzonex Cloud are reminded on WhatsApp (and Telegram) **7, 3 and 1 day before
  their paid month or free trial ends**, next to the invoice, due, paused and paid notices.
- Each business chooses **English, Arabic or Kiswahili** (Alerts → WhatsApp). Default texts are
  included; the platform admin can change them on **Businesses → Billing messages**, with a preview.
- Billing messages go to the business's alert numbers, or the phone it signed up with.
- The WhatsApp sender on the tunnel server can hold one linked number per business (for later use).
- Migration `20261017150000_billing_reminders.sql` (applied).

## 17 October 2026 — WhatsApp alerts

- Alerts can go to **WhatsApp from a normal number, without an API key**: a second SIM is linked to
  the tunnel server like WhatsApp Web (Businesses → WhatsApp sender: one install command, then scan
  the QR code). Each business saves up to 5 WhatsApp numbers on **Alerts** and can send a test.
- Every alert goes to Telegram and WhatsApp, each at most once, even when one of them is retried.
- The tunnel server keeps extra relay routes in `/etc/caddy/hzc.d`, so re-running its script no
  longer removes the WhatsApp route.
- Migration `20261017120000_whatsapp_alerts.sql` (applied). See README → Alerts.
- Unofficial way of sending: use a separate SIM, never your personal number.

## 17 October 2026 — consistency pass

A review of the whole app for the same words, the same look and small bugs.

### Database (migration `20261017090000_review_fixes.sql`, applied)
- The audit log no longer writes some events twice: voids are logged once by `void_sale`, and staff
  or plan changes made by an Edge Function are logged once by that function with the real person.
- Retry-safe selling: when the same sale attempt arrives twice at the same moment, the second reply
  returns the sale only to the same cashier.
- Two internal helper functions can no longer be called by signed-in users.
- Every migration is applied and the web app's database types were regenerated from the live
  project; `web/src/lib/database.pending.ts` keeps only the generator gaps.

### Same words everywhere
- **Voucher** for the code, **card** for the printed paper and the customer's screens.
- Role labels **Owner / Manager / Cashier / agent**; **Revenue** for money taken.
- Page headers and buttons look and read the same on every page; dark-mode gaps filled.

### Bugs fixed
- The router edit form was reset every 5 seconds while you typed.
- The "payment confirmed" message disappeared too soon.
- Billing crashed when the phone was offline.
- Lists showed old figures after a sale, an expense or a staff change.
- The switch on **Mark as sold** for choosing the router did not work.

## Sell-ready release — 16 October 2026

Findings and plan: [AUDIT.md](AUDIT.md), [PLAN.md](PLAN.md). Every change below is on the branch
`claude/clever-mccarthy-1780c7`; the web app deploys from it automatically. All database migrations from this release are applied.

### Phase 1 — security and bugs
- **Audit trail** (migration `20261016170000_audit_trail.sql`): every sale, voucher batch, plan or
  price change and staff role/access change is written to `audit_log` (who, what, when, which
  business), whatever screen or worker made it. Voids, cash handovers, seller terms and changes made
  by Edge Functions are logged by their own functions (no duplicates since `20261017090000`).
- **Retry-safe selling** (migration `20261016171000_idempotent_sell.sql` + Sell page): each sale
  attempt carries a request id; a lost reply is retried automatically and returns the same card, so
  a bad connection can no longer sell two cards.
- **Tighter grants** (migration `20261016172000_tighten_grants.sql`): no TRUNCATE / TRIGGER /
  REFERENCES for signed-in users or visitors.
- **Friendly 404 page**; a page that fails to draw shows "Reload" instead of a white screen.
- **ESLint** added (`npm run lint`, zero warnings); **zod** checks on every form that changes money
  or access (generate, staff, router, plans, sign-up, Buy page, cash received, payment reference),
  with unit tests.

### Phase 2 — UX/UI and mobile
- Plain role names: **Owner, Manager, Cashier / Agent** (database values unchanged).
- Sale screen: **Print** and **Share** (phone share sheet, WhatsApp fallback); USD next to SSP.
- **Business settings** page: name, logo upload, dollar rate (migration
  `20261016180000_business_settings.sql`). USD (≈ $) shows next to SSP on the dashboard, sale
  screen and reports once a rate is set.
- Dashboard: router online/offline list with last seen; **cards expiring in the next 24 hours**
  (migration `20261016181000_dashboard_expiring.sql`); "Finish setting up" banner for new owners.
- Accessibility: AA contrast for small grey text; every button, link and field ≥ 44 px; checked at
  360 px wide for owners and cashiers with no sideways scrolling.

### Phase 3 — sell-readiness
- **Landing page** at `/` for visitors (features, real screenshots, prices, FAQ, WhatsApp / phone /
  office, sign-up and demo); staff who are logged in go straight to their first page.
- **Subscription plans with limits** enforced by the database (migration
  `20261016190000_subscription_plans.sql`, applied 16 October 2026): Starter (1 router, 1 site, 3 staff, 5,000 vouchers a
  month), Business (5 / 3 / 15 / 30,000), Pro (no limits); optional price per plan. Owners see
  their plan and usage on Billing; on Businesses you edit plans, move a business to another plan
  and extend trials (+14 / +30 days). Existing businesses start on Business, new ones on Starter.
  Businesses that are not billed (yours) have no limits.
- **Welcome wizard** after sign-up: details and logo, site, router, plan, first cards.
- **Sharing and install**: title, description, Open Graph / Twitter tags with a preview image,
  `robots.txt`, `sitemap.xml`, `manifest.webmanifest` (installable on Android).
- Terms of Service and privacy page (starter text, marked for you to review), proprietary LICENSE.

### Phase 4 — polish
- Database types generated from the live schema and used by the Supabase client
  (`web/src/lib/database.types.ts`; `web/src/lib/database.pending.ts` keeps only what the
  generator cannot see).
- Folders: `features/<area>/` for pages, `components/ui/` for the UI kit, `hooks/` for data hooks.
- README: every Edge Function to deploy, environment variables, roles, lint, applying migrations.

### Also fixed earlier today (already live)
Router worker (wrong router clocks, stuck tests, alert spam, long deletes), billing (switch-off on
the due day, voided invoices coming back, trial for added businesses, "Not billed" unpausing),
sign-up and Buy spam limits, owner-login protection, internal-address router hosts, router field
limits, the Buy page stuck on "Loading…", poster QR border and join-WiFi QR, 2-step code screen.

### Plans separate from MikroTicket (applied)
- Router profiles no longer become Hotzonex plans by themselves (migration
  `20261016200000_no_mikroticket_plans.sql`, applied at your request; undo steps inside it).
- The 9 plans made from MikroTicket profiles are switched off and shown under "Old MikroTicket
  plans"; MikroTicket cards keep working and are still counted in reports.
- New plans always get Hotzonex's own router profile `hzc-<plan>-<price>`.

### Expenses and profit (applied)
- New **Expenses & profit** page (owners and managers): record expenses (internet, power, rent,
  salaries, feeding, equipment, repairs, printing, transport, other) for a site or the whole business; see
  sales − agent commission − expenses = **profit** per day, week or month, day by day and per
  category, with Print and CSV. Managers record and see only their own site's expenses.
- Reports shows commission, expenses and profit under the summary, with a link to the page.
- Migration `20261016210000_expenses.sql` (new table and functions only; every change is written
  to the audit log), applied on 16 October 2026 and recorded in the migration history.
- Category **Feeding** added (migration `20261016220000_expense_feeding.sql`, applied).

### Dark mode
- **Light / Dark / Auto** switch at the bottom of the menu (Auto follows the phone or computer).
  Saved on each device; Light is the default. Printed cards, receipts and reports are always light.

## What you need to do

Every migration is applied (latest 17 October 2026) and the database types are regenerated, so
nothing is left to apply. What is left for you:

1. **Make the GitHub repository private** (Settings → General → Danger Zone → Change visibility).
   Then check that DigitalOcean still deploys (App → Settings → Source; reconnect GitHub if asked).
2. **Read the Terms page** (`/terms`) and change anything you do not agree with.
3. **Contact email**: add a public business email in `web/src/lib/contact.ts` (it is hidden
   until then; your personal email is not published).
4. Optional: add `TELEGRAM_BOT_TOKEN` in Supabase → Edge Functions → Secrets for Telegram alerts;
   upgrade Supabase to Pro for daily backups and leaked-password protection.
5. Good to do: check the plan limits and prices on Businesses → Subscription plans, and that each
   customer is on the right plan (existing ones started on Business). Write down the router
   password key (README → Backups) somewhere safe.

No new environment variables and no DNS changes are needed.

## Decisions (AUDIT.md §0)
- Hosting stays on **DigitalOcean**; the mobile-money **Buy page stays** (owner, 16 October 2026).
- Role values in the database stay `admin / manager / seller`; only the labels changed.

## Recommended next steps
- Agent codes printed on cards for agents who sell offline, settled at cash-up.
- A per-business audit log page (the data is already being recorded).
- Automatic code swap when a mobile-money card's code clashes with a router user.
- Supabase Pro + the backup script on a schedule (README → Backups).

## Known follow-ups
- Routers connected by **script** (cloud) do not record router logins, so "expiring soon" and
  MikroTicket activations need routers connected **directly** or through the **tunnel**.
- The router login portal lists **every active plan of the business**, not only the plans of
  that router.
- Security headers (X-Frame-Options and others) are only in `web/vercel.json`, so they are **not**
  sent on DigitalOcean.
- The web app shows times in Africa/Juba, while the database uses each business's own time zone
  (the same for businesses in South Sudan; different for a business elsewhere).
- No automated tests for the database (SQL) functions yet.
- `router-direct` compares its worker secret with a plain compare, not a constant-time one.
