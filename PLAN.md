# Hotzonex Cloud — Work plan

Findings are in [AUDIT.md](AUDIT.md). New database changes are written as **new migration files** in
`supabase/migrations/` and are **not applied to production** until you have reviewed them. The web
app deploys automatically from the branch, so every web change keeps working before and after its
migration is applied.

Decisions D1–D5 in AUDIT.md §0 are open. Until you answer, the plan keeps the mobile-money Buy page,
DigitalOcean hosting, the Edge-Function router worker and the existing role values.

## Phase 1 — critical security and bugs
1. **Audit trail for money and setup events** (migration `20261016170000_audit_trail.sql`): triggers
   record sales, voids, voucher batches, plan and price changes, staff role/active changes and cash
   handovers in `audit_log` (who, what, when, which business).
2. **Idempotent sell** (migration `20261016171000_idempotent_sell.sql`): `sales.request_id` (unique per
   business) and `sell_voucher(p_router_id, p_plan_id, p_request_id)` returns the *same* sale when the
   same request is sent again. The Sell page sends one request id per tap and reuses it on retry.
3. **Tighter grants** (migration `20261016172000_tighten_grants.sql`): revoke TRUNCATE / TRIGGER /
   REFERENCES from `authenticated` and `anon` on all tables.
4. **Friendly 404 page** instead of a silent redirect.
5. **Lint**: add ESLint (TypeScript + React hooks rules) with a `lint` script; fix every error.
6. **zod** validation for the forms that change money or access: sell, generate vouchers, staff,
   router, plans, sign-up, Buy page.
7. Owner action (cannot be done from code): make the GitHub repository **private**.

## Phase 2 — UX/UI and mobile
1. Role labels in plain words: Owner, Manager, Cashier / Agent (labels only, see D4).
2. Sell flow: 3 taps (site remembered → plan → done); big code screen with **Print** and **Share**
   (WhatsApp / SMS through the phone's share sheet).
3. SSP + USD: exchange rate per business (owner sets it); USD shown next to SSP on dashboard, sale
   screen and reports.
4. Dashboard: add "expiring soon" and a router online/offline list.
5. Reports: agent filter label, totals row, CSV for every report view.
6. Accessibility pass: contrast of small grey text, focus order, labels.

## Phase 3 — sell-readiness
1. Public landing page at `/` (headline, features, screenshots, pricing, FAQ, WhatsApp / phone /
   email contact, Sign up and Request demo). Logged-in users go straight to their dashboard.
2. Subscription plans with limits (routers, sites, staff, vouchers per month) enforced in the
   database; owners see usage vs limits on the Billing page; the super-admin page can activate,
   extend or suspend a business and change its plan.
3. Onboarding wizard after sign-up: business name and logo, currency, first site, first router,
   first plan.
4. SEO and sharing: meta description, Open Graph / Twitter tags, `robots.txt`, `sitemap.xml`.
5. Installable app: `manifest.webmanifest` with icons (the service worker already exists).

## Phase 4 — polish and code quality
1. Generated Supabase types (`supabase gen types`) used in queries.
2. Folder structure: `features/`, `components/ui/`, `hooks/`, `lib/`; remove dead code.
3. README: setup, environment variables, migration steps, deployment (DigitalOcean and Vercel).
4. CHANGELOG.md: what changed, what you must do by hand, next steps.

Each phase ends with `npm run typecheck`, `npm run lint`, `npm test` and `npm run build`, all passing.
