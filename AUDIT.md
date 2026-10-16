# Hotzonex Cloud — Audit (16 October 2026)

Scope: the whole repository (`web/`, `supabase/migrations`, `supabase/functions`, `scripts/`) and the live
Supabase project (tables, RLS policies, grants, functions, indexes, cron jobs, logs). Ratings:
**Critical / High / Medium / Low**. "Done" marks items already fixed earlier today (kept for the record).

## 0. Where the brief and the real system differ (decisions needed)

| # | Brief says | System today | Recommendation |
|---|---|---|---|
| D1 | Cash and agent codes **only, no mobile money** | A mobile-money "Buy" page (`web/src/pages/BuyPage.tsx`, `supabase/functions/buy`), a Payments page, and a poster QR are live and in use (the owner asked for them). | **Keep** it (a cashier confirms every payment; no money passes through the app). Removing it deletes a live feature — needs your yes. |
| D2 | Deployed on **Vercel** | Deployed on **DigitalOcean App Platform** (`.do/app.yaml`), Vercel kept as an alternative in the README. | Keep DigitalOcean; the README covers both. |
| D3 | A separate **Node router API on the VPS** | Router work runs in Supabase Edge Functions (`router-direct`, `router-gateway`); the VPS only runs WireGuard and an HTTPS relay (`supabase/functions/_shared/tunnel.ts`). | Keep: no long-running server to maintain. |
| D4 | Roles **owner / manager / cashier / agent** | `profiles.role` ∈ `admin / manager / seller`; "agent" = a seller with commission and credit limit (`cash_handovers`, `set_seller_terms`). | Rename only the **labels** in the UI (Owner, Manager, Cashier/Agent). Renaming the database values is a breaking change to many functions — needs your yes. |
| D5 | Routers added by **private IP** | Routers join over the WireGuard tunnel (private 10.99.0.x); public IP ("direct") also supported. | Matches the intent. |

## 1. Security

| Rating | Finding | Where |
|---|---|---|
| **Critical** | The GitHub repository is **public**: anyone can download the full source. Only the owner can change this (Settings → Change visibility → Private). | GitHub settings |
| High | **No audit trail for money events.** `audit_log` records router, staff-creation, deletes and support actions, but **not** sales, voids, voucher generation, plan/price changes, staff role/active changes or cash handovers. | live `audit_log` actions; `sell_voucher`, `void_sale`, `generate_vouchers`, `record_cash_handover` |
| Medium | `authenticated` holds `TRUNCATE`, `TRIGGER`, `REFERENCES` (and `DELETE`) on `plan_routers` and `router_profile_ignores`. Not reachable through the REST API (no TRUNCATE endpoint), but more than the app needs. | table grants |
| Medium | Voucher codes are 7-digit numbers (needed for MikroTicket login pages): 10⁷ possibilities, made with `gen_random_bytes` (unbiased, cryptographic). Guessing is limited only by the router's login page. | `random_numeric_code` |
| Medium | Leaked-password protection is off (needs Supabase Pro). | Supabase Auth settings |
| Low | `pg_net` is installed in the `public` schema (advisor warning). | extensions |
| Done | Router passwords and WireGuard keys are encrypted (AES-GCM, key in Vault) and never sent to the browser (column grants hide `password_enc`, `wg_private_enc`). | `_shared/crypto.ts`, routers grants |
| Done | No service-role key or other secret in the frontend; only the public anon key (`web/src/lib/supabase.ts`). Git history scanned: clean. | — |
| Done | 2-step login (TOTP) enforced in the database for platform powers (`mfa_satisfied`, `is_platform_admin`). | migrations `20261015200000`, `20261015201000` |
| Done | CSP meta tag, CORS allowlist, rate limits by Cloudflare client IP, SSRF guard on router hosts, owner login protected. | `vite.config.ts`, `_shared/cors.ts`, `buy`, `signup`, `add-router`, `create-staff` |

## 2. Data / multi-tenancy

| Rating | Finding | Where |
|---|---|---|
| High | **Sell is not idempotent across retries.** A double tap is blocked (`SellPage.tsx` ref guard), but if the network drops after the server sold the card and the cashier taps again, a **second card is sold**. Needs a request id the server remembers. | `sell_voucher`, `SellPage.tsx` |
| Done | Every tenant table has `tenant_id`, RLS on, and a RESTRICTIVE `tenant_isolation` policy (`app_tenant_id()`); no anon grants. Exceptions are global by design: `tenants` (own row only), `platform_admins`, `app_config` (no grants), `agent_status` (legacy, no grants). | pg_policies |
| Done | A voucher can be sold only once: `sales.voucher_id` UNIQUE + `FOR UPDATE SKIP LOCKED` in `sell_voucher`; codes UNIQUE per router (`vouchers_code_per_router`). | indexes |
| Low | `agent_status` and `routers.ip_address` are unused legacy objects (drop needs your yes). | schema |

## 3. Performance

| Rating | Finding | Where |
|---|---|---|
| Medium | Initial download ≈ **146 KB gzip** (React 65 KB + Supabase 58 KB + app 16 KB + CSS 7 KB). Routes are already lazy-loaded (`lib/lazyPage.ts`). The public pages (login, buy, terms) still load the whole Supabase client. | `web/dist` |
| Low | 17 foreign keys without an index (advisor), all on small tables (`alerts`, `payment_requests`, `cash_handovers`…). | performance advisor |
| Done | Vouchers (50/page) and Sales (100/page) are paginated; reports aggregate in SQL; indexes exist for tenant_id, created/sold_at, status, code. React Query caches with background refresh, persisted for the small screens. | `VouchersPage.tsx:14`, `SalesPage.tsx:13` |

## 4. UX / UI

| Rating | Finding | Where |
|---|---|---|
| High | **No public landing page.** `/` sends visitors straight to the login form; nothing explains the product, prices or how to contact you. | `web/src/App.tsx` (`HomeRedirect`) |
| Medium | **No 404 page:** unknown addresses silently redirect to login/dashboard. | `App.tsx:127` |
| Medium | Sell confirmation has Print but **no Share** (WhatsApp/SMS) button. | `SellPage.tsx` |
| Medium | No **USD** display (SSP only). `tenants.currency` exists but is unused. | `lib/format.ts` |
| Medium | Dashboard lacks "expiring soon" and a per-router online/offline list on the same screen. | `DashboardPage.tsx` |
| Low | Role labels "Admin / Seller" differ from the brief's Owner / Cashier / Agent. | `lib/nav.ts:79` |
| Done | Design tokens (brand #15479c), grouped menu, phone bottom tab bar, big tap targets, error screen with Reload, plain English, CSV export in Reports, A4 sheet + 58/80 mm receipt printing. | `tailwind.config.js`, `Layout.tsx`, `print/` |

## 5. Mobile

| Rating | Finding | Where |
|---|---|---|
| Medium | **Not installable as an app**: there is a service worker (`dist/sw.js`) but **no web manifest**, so "Add to Home screen" gives a plain bookmark. | `web/index.html`, `web/public` |
| Done | No sideways scroll at 360–390 px (fixed today), tables scroll inside their card, Buy page works without the login library and gives up after 20 s with "Try again". | `index.css`, `BuyPage.tsx` |

## 6. Accessibility

| Rating | Finding | Where |
|---|---|---|
| Low | Inputs have visible labels (`Field`), focus rings exist (`index.css` focus-visible). Not yet checked with an automated contrast tool; some `text-slate-400/500` small print may be below AA on white. | `components/ui.tsx` |

## 7. Code quality

| Rating | Finding | Where |
|---|---|---|
| Medium | **No linter** (no ESLint config); only `tsc`. | `web/` |
| Medium | **No zod**: forms and RPC inputs are validated by hand (database and Edge Functions re-check everything, so this is about consistent client messages). | `web/src/pages/*` |
| Medium | Supabase types are hand-written (`lib/types.ts`), not generated. | `web/src/lib/types.ts` |
| Low | Flat `pages/` folder (25 files) instead of `features/`. | `web/src` |
| Done | TypeScript strict (+ `noUncheckedIndexedAccess`), **0 `any`**, 61 unit tests for the router/billing/buy logic (`npm test`). | `tsconfig.json` |

## 8. SEO / marketing

| Rating | Finding | Where |
|---|---|---|
| High | No meta description, Open Graph or Twitter tags: links shared on WhatsApp/Facebook show no preview. | `web/index.html` |
| Medium | No `robots.txt` or `sitemap.xml`. | `web/public` |

## 9. Missing for selling

| Rating | Finding | Where |
|---|---|---|
| High | **No subscription plans with limits** (routers, sites, staff, vouchers per month). Billing today is one price per router per month, manual confirmation. | `20261015180000_billing.sql` |
| Medium | No onboarding wizard (sign-up drops the owner on "Add router"). | `SignupPage.tsx` |
| Medium | Super-admin page exists (Businesses: switch on/off, support mode, billing, invoices) but has no **usage vs limits** and no "extend trial" shortcut. | `BusinessesPage.tsx`, `PlatformBilling.tsx` |
| Done | Terms of Service + privacy page, proprietary LICENSE, per-business logo on printed cards. | `TermsPage.tsx`, `LICENSE` |
