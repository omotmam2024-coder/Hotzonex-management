-- The LAN fields are no longer used: hide them from the browser.
revoke select (ip_address, port, use_https, username) on public.routers from authenticated;
revoke update (ip_address, port, use_https, username) on public.routers from authenticated;
