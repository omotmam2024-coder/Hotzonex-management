-- Each business can have its own logo for printed cards and receipts (a URL or a path on the website).
alter table public.tenants add column logo_url text check (logo_url is null or length(logo_url) <= 500);
update public.tenants set logo_url = '/logo.png' where name = 'Hotzonex WiFi';
grant update (logo_url) on public.tenants to authenticated;
