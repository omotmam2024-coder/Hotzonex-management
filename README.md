# Hotzonex Cloud

MikroTik hotspot voucher management for Hotzonex WiFi, Juba (Gorom, Jebel Iraq, HQ, Sub-Office).

| Folder | What it is | Runs on |
| --- | --- | --- |
| `web/` | React 18 + TypeScript + Vite + Tailwind staff app | Vercel |
| `supabase/` | Database migration and Edge Functions | Supabase cloud |
| `agent/` | Router Agent (Node.js 20) that talks to routers by private IP | Always-on PC on the router LAN |

The browser never talks to a router. It writes jobs to Supabase; the Router Agent on the LAN
polls those jobs over outbound HTTPS and calls each router's RouterOS v7 REST API.

> Status: **Phase 1** (project setup and login). Full setup, deployment and backup notes are completed in Phase 8.

## Phase 1 setup

### 1. Supabase project

1. Create a project at <https://supabase.com> (region closest to Juba, e.g. Europe/Frankfurt).
2. Run the migration: either `supabase link --project-ref <ref> && supabase db push`,
   or paste `supabase/migrations/20261010000000_hotzonex_schema.sql` into **SQL Editor** and run it.
3. **Authentication → Providers → Email**: keep Email enabled, turn **off** "Allow new users to sign up".

### 2. First admin and a test seller

Create both users in **Authentication → Users → Add user** (tick "Auto Confirm User"), then run in the SQL Editor:

```sql
insert into public.sites (name) values ('Gorom');

insert into public.profiles (id, full_name, role, site_id)
select id, 'Omot (Admin)', 'admin', null from auth.users where email = 'admin@example.com';

insert into public.profiles (id, full_name, role, site_id)
select u.id, 'Test Seller', 'seller', s.id
from auth.users u, public.sites s
where u.email = 'seller@example.com' and s.name = 'Gorom';
```

(From Phase 3 on, staff are created from the **Staff** page instead.)

### 3. Web app

```bash
cd web
cp .env.example .env      # fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm install
npm run dev               # http://localhost:5173
```

### 4. Router Agent (connection check only in Phase 1)

```bash
cd agent
cp .env.example .env      # fill in SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ROUTER_SECRET_KEY
npm install
npm run check             # prints "Connected to Supabase"
```

## Roles

| Role | Menu |
| --- | --- |
| Admin | Dashboard, Sell, Vouchers, Plans, Routers, Sales, Reports, Active Users, Staff |
| Manager | Dashboard, Sell, Vouchers, Sales, Reports, Active Users (own site) |
| Seller | Sell, Sales (own site) |

Opening a page your role cannot use sends you back to your home page (Dashboard, or Sell for sellers).
