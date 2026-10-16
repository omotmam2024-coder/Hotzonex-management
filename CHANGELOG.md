# Changelog

## Sell-ready release — 16 October 2026

Findings and plan: [AUDIT.md](AUDIT.md), [PLAN.md](PLAN.md). Every change below is on the branch
`claude/clever-mccarthy-1780c7`; the web app deploys from it automatically. **Database migrations
from this release are written but not applied** — see "What you need to do" below.

### Phase 1 — security and bugs
- **Audit trail** (migration `20261016170000_audit_trail.sql`): every sale, void, voucher batch,
  plan or price change and staff role/access change is written to `audit_log` (who, what, when,
  which business), whatever screen or worker made it. Cash handovers and seller terms were already
  logged by their own functions.
- **Retry-safe selling** (migration `20261016171000_idempotent_sell.sql` + Sell page): each sale
  attempt carries a request id; a lost reply is retried automatically and returns the same card, so
  a bad connection can no longer sell two cards. Works before the migration too (old behaviour).
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
  (`web/src/lib/database.types.ts`; objects from the pending migrations in
  `web/src/lib/database.pending.ts`).
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

## What you need to do

1. **Make the GitHub repository private** (Settings → General → Danger Zone → Change visibility).
   Then check that DigitalOcean still deploys (App → Settings → Source; reconnect GitHub if asked).
2. **Apply the last two migrations** in Supabase → SQL Editor (paste each file, Run):
   `20261016170000_audit_trail.sql` and `20261016171000_idempotent_sell.sql`. The others
   (tighten_grants, business_settings, dashboard_expiring, subscription_plans, expenses) were applied
   on 16 October 2026. The app works before and after; after applying, regenerate the types (see
   README → Database migrations).
3. **Check the plan limits and prices** on Businesses → Subscription plans after applying, and
   move each customer to the right plan (existing ones start on Business).
4. **Read the Terms page** (`/terms`) and change anything you do not agree with.
5. **Contact email**: add a public business email in `web/src/lib/contact.ts` (it is hidden
   until then; your personal email is not published).
6. Optional: add `TELEGRAM_BOT_TOKEN` in Supabase → Edge Functions → Secrets for Telegram alerts;
   upgrade Supabase to Pro for daily backups and leaked-password protection.
7. No new environment variables and no DNS changes are needed.

## Decisions (AUDIT.md §0)
- Hosting stays on **DigitalOcean**; the mobile-money **Buy page stays** (owner, 16 October 2026).
- Role values in the database stay `admin / manager / seller`; only the labels changed.

## Recommended next steps
- Agent codes printed on cards for agents who sell offline, settled at cash-up.
- A per-business audit log page (the data is recorded once the migration is applied).
- Automatic code swap when a mobile-money card's code clashes with a router user.
- Supabase Pro + the backup script on a schedule (README → Backups).
