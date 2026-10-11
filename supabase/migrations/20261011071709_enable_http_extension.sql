-- Lets an admin call the router-gateway Edge Function from SQL for diagnostics, e.g.
--   select status, content from extensions.http(('POST', '<project-url>/functions/v1/router-gateway',
--     array[extensions.http_header('x-hzc-token', '<token>')], 'text/plain', E'H|1\n')::extensions.http_request);
create extension if not exists http with schema extensions;
