-- The tenants.timezone check runs as the signed-in admin who renames or re-zones a business.
grant execute on function public.is_valid_timezone(text) to authenticated;
