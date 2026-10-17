# Hotzonex Cloud — Work plan

Findings are in [AUDIT.md](AUDIT.md). **Status (17 October 2026): all four phases are done** and every
migration in `supabase/migrations/` is applied to production (latest `20261017090000_review_fixes.sql`).
New database changes are still written as **new migration files** and applied only after review.
The web app deploys automatically to DigitalOcean App Platform from the branch
`claude/clever-mccarthy-1780c7`.

Decisions taken (AUDIT.md §0):
- **Hosting:** keep DigitalOcean App Platform (Vercel is not supported).
- **Mobile money:** keep the Buy page (a cashier confirms every payment).
- **Router worker:** keep the Edge Functions; the VPS only runs the WireGuard tunnel relay.
- **Roles:** keep the database values `admin / manager / seller`; only the labels changed
  (Owner / Manager / Cashier / agent).

## Phase 1 — critical security and bugs
**Status: done** (16 October 2026). Only the owner action in step 7 is left.

1. **Audit trail for money and setup events** (migration `20261016170000_audit_trail.sql`): triggers
   record new sales, voucher batches, plan and price changes and staff role/active/site changes in
   `audit_log` (who, what, when, which business). The trigger intentionally does **not** record cash
   handovers or seller terms (their own functions already log them), and voids are logged by
   `void_sale`; `20261017090000_review_fixes.sql` removed the duplicate rows.
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
**Status: done** (16 October 2026; wording made consistent on 17 October).

1. Role labels in plain words: Owner, Manager, Cashier / agent (labels only, see D4).
2. Sell flow: 3 taps (site remembered → plan → done); big code screen with **Print** and **Share**
   (WhatsApp / SMS through the phone's share sheet).
3. SSP + USD: exchange rate per business (owner sets it); USD shown next to SSP on dashboard, sale
   screen and reports.
4. Dashboard: add "expiring soon" and a router online/offline list.
5. Reports: agent filter label, totals row, CSV for every report view.
6. Accessibility pass: contrast of small grey text, focus order, labels.

## Phase 3 — sell-readiness
**Status: done** (16 October 2026). Owner actions left: read `/terms`, add a public business email.

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
**Status: done** (16–17 October 2026).

1. Generated Supabase types (`supabase gen types`) used in queries.
2. Folder structure: `features/`, `components/ui/`, `hooks/`, `lib/`; remove dead code.
3. README: setup, environment variables, migration steps, deployment (DigitalOcean App Platform).
4. CHANGELOG.md: what changed, what you must do by hand, next steps.

## Added after the plan (done, applied)
- Expenses & profit page, Reports profit line, dark mode (16 October 2026).
- Consistency pass and `20261017090000_review_fixes.sql` (17 October 2026).

Open points are listed in [CHANGELOG.md](CHANGELOG.md) → Known follow-ups.

Each phase ends with `npm run typecheck`, `npm run lint`, `npm test` and `npm run build`, all passing.
