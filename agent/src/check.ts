import { ConfigError, loadConfig } from './config.js';
import { createServiceClient } from './supabase.js';
import { log } from './logger.js';

/** Verifies agent/.env and that this computer can reach Supabase with the service role key. */
async function main(): Promise<void> {
  const config = loadConfig();
  log.info('Configuration loaded', { supabaseUrl: config.supabaseUrl });

  const supabase = createServiceClient(config);
  const { count, error } = await supabase.from('sites').select('id', { count: 'exact', head: true });
  if (error) {
    throw new Error(`Supabase answered with an error: ${error.message}. Check SUPABASE_SERVICE_ROLE_KEY and that the migration has run.`);
  }
  log.info('Connected to Supabase', { sites: count ?? 0 });
}

main().catch((err: unknown) => {
  if (err instanceof ConfigError) log.error(err.message);
  else if (err instanceof Error && /fetch failed/i.test(err.message))
    log.error('Cannot reach Supabase. Check the internet connection and SUPABASE_URL.');
  else log.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
