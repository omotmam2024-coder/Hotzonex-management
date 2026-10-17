# Hotzonex Cloud — Audit (16 October 2026)

Scope: the whole repository (`web/`, `supabase/migrations`, `supabase/functions`, `scripts/`) and the live
Supabase project (tables, RLS policies, grants, functions, indexes, cron jobs, logs). Ratings:
**Critical / High / Medium / Low**. "Done" marks items already fixed on 16 October before this audit
(kept for the record).

**Status (17 October 2026)**: each finding below has a Status column, **Fixed** or **Open**, checked
against the code and the live project on 17 October 2026. Paths were updated to the current folders
(`web/src/features/…`, `web/src/components/ui/index.tsx`). Every migration named here is applied.
Newer open points are listed in [CHANGELOG.md](CHANGELOG.md) → Known follow-ups.

## 0. Where the brief and the real system differ (decisions)

| # | Brief says | System today | Recommendation | Status (17 Oct 2026) |
|---|---|---|---|---|
| D1 | Cash and agent codes **only, no mobile money** | A mobile-money "Buy" page (`web/src/features/public/BuyPage.tsx`, `supabase/functions/buy`), a Payments page, and a poster QR are live and in use (the owner asked for them). | **Keep** it (a cashier confirms every payment; no money passes through the app). | Decided: **kept** (owner, 16 Oct) |
| D2 | Deployed on **Vercel** | Deployed on **DigitalOcean App Platform** (`.do/app.yaml`). | Keep DigitalOcean. | Decided: **DigitalOcean only**; Vercel marked unsupported in the README |
| D3 | A separate **Node router API on the VPS** | Router work runs in Supabase Edge Functions (`router-direct`, `router-gateway`); the VPS only runs WireGuard and an HTTPS relay (`supabase/functions/_shared/tunnel.ts`). | Keep: no long-running server to maintain. | Decided: kept |
| D4 | Roles **owner / manager / cashier / agent** | `profiles.role` ∈ `admin / manager / seller`; "agent" = a seller with commission and credit limit (`cash_handovers`, `set_seller_terms`). | Rename only the **labels** in the UI. | Decided: values kept, labels **Owner / Manager / Cashier / agent** |
| D5 | Routers added by **private IP** | Routers join over the WireGuard tunnel (private 10.99.0.x); public IP ("direct") also supported. | Matches the intent. | Decided: kept |

## 1. Security

| Rating | Finding | Where | Status (17 Oct 2026) |
|---|---|---|---|
| **Critical** | The GitHub repository is **public**: anyone can download the full source. Only the owner can change this (Settings → Change visibility → Private). | GitHub settings | **Open** (owner action) |
| High | **No audit trail for money events.** `audit_log` recorded router, staff-creation, deletes and support actions, but **not** sales, voids, voucher generation, plan/price changes, staff role/active changes or cash handovers. | `sell_voucher`, `void_sale`, `generate_vouchers`, `record_cash_handover` | **Fixed** (`20261016170000_audit_trail.sql`, duplicates removed in `20261017090000_review_fixes.sql`; cash handovers and seller terms are logged by their own functions) |
| Medium | `authenticated` holds `TRUNCATE`, `TRIGGER`, `REFERENCES` (and `DELETE`) on `plan_routers` and `router_profile_ignores`. Not reachable through the REST API, but more than the app needs. | table grants | **Fixed** (`20261016172000_tighten_grants.sql`; DELETE kept on purpose for unlinking) |
| Medium | Voucher codes are 7-digit numbers (needed for MikroTicket login pages): 10⁷ possibilities, made with `gen_random_bytes` (unbiased, cryptographic). Guessing is limited only by the router's login page. | `random_numeric_code` | **Open** (accepted: needed for MikroTicket compatibility) |
| Medium | Leaked-password protection is off (needs Supabase Pro). | Supabase Auth settings | **Open** (needs Supabase Pro) |
| Low | `pg_net` is installed in the `public` schema (advisor warning). | extensions | **Open** |
| Done | Router passwords and WireGuard keys are encrypted (AES-GCM, key in Vault secret `router_secret_key`) and never sent to the browser (column grants hide `password_enc`, `wg_private_enc`). | `_shared/crypto.ts`, routers grants | Fixed |
| Done | No service-role key or other secret in the frontend; only the public anon key (`web/src/lib/supabase.ts`). Git history scanned: clean. | — | Fixed |
| Done | 2-step login (TOTP) enforced in the database for platform powers (`mfa_satisfied`, `is_platform_admin`). | migrations `20261015200000`, `20261015201000` | Fixed |
| Done | CSP meta tag, CORS allowlist, rate limits by Cloudflare client IP, SSRF guard on router hosts, owner login protected. | `vite.config.ts`, `_shared/cors.ts`, `buy`, `signup`, `add-router`, `create-staff` | Fixed |

## 2. Data / multi-tenancy

| Rating | Finding | Where | Status (17 Oct 2026) |
|---|---|---|---|
| High | **Sell is not idempotent across retries.** A double tap is blocked, but if the network drops after the server sold the card and the cashier taps again, a **second card is sold**. Needs a request id the server remembers. | `sell_voucher`, `web/src/features/sell/SellPage.tsx` | **Fixed** (`20261016171000_idempotent_sell.sql` + Sell page; same-cashier check tightened in `20261017090000_review_fixes.sql`) |
| Done | Every tenant table has `tenant_id`, RLS on, and a RESTRICTIVE `tenant_isolation` policy (`app_tenant_id()`); no anon grants. Exceptions are global by design: `tenants` (own row only), `platform_admins`, `app_config` (no grants), `agent_status` (legacy, no grants). | pg_policies | Fixed |
| Done | A voucher can be sold only once: `sales.voucher_id` UNIQUE + `FOR UPDATE SKIP LOCKED` in `sell_voucher`; codes UNIQUE per router (`vouchers_code_per_router`). | indexes | Fixed |
| Low | `agent_status` and `routers.ip_address` are unused legacy objects (drop needs your yes). | schema | **Open** |

## 3. Performance

| Rating | Finding | Where | Status (17 Oct 2026) |
|---|---|---|---|
| Medium | Initial download ≈ **146 KB gzip** (React 65 KB + Supabase 58 KB + app 16 KB + CSS 7 KB). Routes are already lazy-loaded (`lib/lazyPage.ts`). The public pages (login, buy, terms) still load the whole Supabase client. | `web/dist` | **Open** |
| Low | 17 foreign keys without an index (advisor), all on small tables (`alerts`, `payment_requests`, `cash_handovers`…). | performance advisor | **Open** |
| Done | Vouchers (50/page) and Sales (100/page) are paginated; reports aggregate in SQL; indexes exist for tenant_id, created/sold_at, status, code. React Query caches with background refresh, persisted for the small screens. | `web/src/features/vouchers/VouchersPage.tsx`, `web/src/features/sales/SalesPage.tsx` | Fixed |

## 4. UX / UI

| Rating | Finding | Where | Status (17 Oct 2026) |
|---|---|---|---|
| High | **No public landing page.** `/` sent visitors straight to the login form. | `web/src/App.tsx`, `web/src/features/public/LandingPage.tsx` | **Fixed** |
| Medium | **No 404 page:** unknown addresses silently redirected to login/dashboard. | `web/src/App.tsx`, `web/src/features/public/NotFoundPage.tsx` | **Fixed** |
| Medium | Sell confirmation had Print but **no Share** (WhatsApp/SMS) button. | `web/src/features/sell/SellPage.tsx` | **Fixed** (Print and Share) |
| Medium | No **USD** display (SSP only). | `lib/format.ts`, `web/src/features/business/BusinessSettingsPage.tsx` | **Fixed** (dollar rate in Business settings) |
| Medium | Dashboard lacked "expiring soon" and a per-router online/offline list. | `web/src/features/reports/DashboardPage.tsx` | **Fixed** (expiring soon needs direct or tunnel routers, see CHANGELOG follow-ups) |
| Low | Role labels "Admin / Seller" differed from the brief's Owner / Cashier / Agent. | `lib/nav.ts` (`ROLE_LABELS`) | **Fixed** |
| Done | Design tokens (brand #15479c), grouped menu, phone bottom tab bar, big tap targets, error screen with Reload, plain English, CSV export in Reports, A4 sheet + 58/80 mm receipt printing. | `tailwind.config.js`, `components/Layout.tsx`, `print/` | Fixed |

## 5. Mobile

| Rating | Finding | Where | Status (17 Oct 2026) |
|---|---|---|---|
| Medium | **Not installable as an app**: there was a service worker but **no web manifest**. | `web/index.html`, `web/public/manifest.webmanifest` | **Fixed** |
| Done | No sideways scroll at 360–390 px, tables scroll inside their card, Buy page works without the login library and gives up after 20 s with "Try again". | `index.css`, `web/src/features/public/BuyPage.tsx` | Fixed |

## 6. Accessibility

| Rating | Finding | Where | Status (17 Oct 2026) |
|---|---|---|---|
| Low | Inputs have visible labels (`Field`), focus rings exist. Some small grey text may have been below AA on white. | `web/src/components/ui/index.tsx` | **Fixed** (AA contrast pass, 44 px targets; no automated contrast test yet) |

## 7. Code quality

| Rating | Finding | Where | Status (17 Oct 2026) |
|---|---|---|---|
| Medium | **No linter** (no ESLint config); only `tsc`. | `web/` | **Fixed** (`web/eslint.config.js`, `npm run lint`) |
| Medium | **No zod**: forms and RPC inputs were validated by hand. | `web/src/features/*`, `web/src/lib/validation.ts` | **Fixed** |
| Medium | Supabase types were hand-written (`lib/types.ts`), not generated. | `web/src/lib/database.types.ts` | **Fixed** (regenerated from the live project; `database.pending.ts` keeps only generator gaps) |
| Low | Flat `pages/` folder (25 files) instead of `features/`. | `web/src` | **Fixed** (`web/src/features/<area>/`) |
| Done | TypeScript strict (+ `noUncheckedIndexedAccess`), **0 `any`**, unit tests for the router/billing/buy logic (`npm test`). | `tsconfig.json` | Fixed (no automated SQL tests yet: open, see CHANGELOG) |

## 8. SEO / marketing

| Rating | Finding | Where | Status (17 Oct 2026) |
|---|---|---|---|
| High | No meta description, Open Graph or Twitter tags. | `web/index.html` | **Fixed** |
| Medium | No `robots.txt` or `sitemap.xml`. | `web/public` | **Fixed** |

## 9. Missing for selling

| Rating | Finding | Where | Status (17 Oct 2026) |
|---|---|---|---|
| High | **No subscription plans with limits** (routers, sites, staff, vouchers per month). | `20261016190000_subscription_plans.sql`, `components/PlanLimits.tsx` | **Fixed** (Starter / Business / Pro, enforced in the database) |
| Medium | No onboarding wizard (sign-up dropped the owner on "Add router"). | `web/src/features/business/WelcomePage.tsx` | **Fixed** |
| Medium | Super-admin page had no **usage vs limits** and no "extend trial" shortcut. | `web/src/features/business/BusinessesPage.tsx`, `components/PlatformBilling.tsx` | **Fixed** (plan, usage, +14 / +30 days) |
| Done | Terms of Service + privacy page, proprietary LICENSE, per-business logo on printed cards. | `web/src/features/public/TermsPage.tsx`, `LICENSE` | Fixed (Terms text still to be read by the owner) |
