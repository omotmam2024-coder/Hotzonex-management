import { ConfigError, loadConfig } from './config.js';
import { log } from './logger.js';
import { bareIp, clientFor, readSystemResource, ROUTER_COLUMNS } from './routers.js';
import { createServiceClient } from './supabase.js';
import type { RouterRow } from './types.js';

/**
 * Setup check, run on the agent computer with `npm run check`:
 *  1. agent/.env is complete and Supabase answers with the service role key;
 *  2. jobs are waiting for the agent;
 *  3. for every router: ROUTER_SECRET_KEY decrypts its password (same key as the Edge
 *     Function secret) and the router answers on its private IP from this computer.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  log.info('Configuration loaded', { supabaseUrl: config.supabaseUrl });

  const supabase = createServiceClient(config);
  const { data: routers, error } = await supabase.from('routers').select(ROUTER_COLUMNS).order('name');
  if (error) {
    throw new Error(`Supabase answered with an error: ${error.message}. Check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (Project Settings → API).`);
  }
  log.info('Connected to Supabase');

  const { count: queued } = await supabase.from('router_jobs').select('id', { count: 'exact', head: true }).eq('status', 'queued');
  log.info(`Jobs waiting for the agent: ${queued ?? 0}${queued ? ' (they run as soon as you start the agent with npm start)' : ''}`);

  const list = (routers ?? []) as RouterRow[];
  if (list.length === 0) log.info('No routers added yet. Add one on the Routers page.');

  let problems = 0;
  for (const router of list) {
    const where = `${router.use_https ? 'https' : 'http'}://${bareIp(router.ip_address)}:${router.port}`;
    try {
      const resource = await readSystemResource(clientFor(router, config));
      log.info(`Router "${router.name}" OK`, { address: where, model: resource['board-name'], version: resource.version });
    } catch (err) {
      problems++;
      log.error(`Router "${router.name}" (${where}): ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (problems) process.exitCode = 1;
}

main().catch((err: unknown) => {
  if (err instanceof ConfigError) log.error(err.message);
  else if (err instanceof Error && /fetch failed/i.test(err.message))
    log.error('Cannot reach Supabase. Check the internet connection and SUPABASE_URL.');
  else log.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
