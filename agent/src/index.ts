import { ConfigError, loadConfig } from './config.js';
import { createHeartbeat, lanAddresses } from './heartbeat.js';
import { JobRunner } from './jobs/runner.js';
import { log } from './logger.js';
import { checkRouterStatus } from './status.js';
import { createServiceClient } from './supabase.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const supabase = createServiceClient(config);

  const { error } = await supabase.from('routers').select('id', { count: 'exact', head: true });
  if (error) throw new Error(`Supabase answered with an error: ${error.message}. Check SUPABASE_SERVICE_ROLE_KEY and that the migration has run.`);

  const runner = new JobRunner(supabase, config);
  await runner.recoverStaleJobs();
  const heartbeat = createHeartbeat(supabase, runner.supportedTypes);
  await heartbeat();
  log.info('Hotzonex Router Agent started', {
    jobs: runner.supportedTypes,
    lanAddresses: lanAddresses(),
    pollEveryMs: config.jobPollIntervalMs,
    statusEveryMs: config.syncIntervalMs,
  });

  let statusRunning = false;
  const runStatus = async () => {
    if (statusRunning) return;
    statusRunning = true;
    try {
      await checkRouterStatus(supabase, config);
    } finally {
      statusRunning = false;
    }
  };

  const jobTimer = setInterval(() => void runner.poll(), config.jobPollIntervalMs);
  const staleTimer = setInterval(() => void runner.recoverStaleJobs(), 60_000);
  const heartbeatTimer = setInterval(() => void heartbeat(), 20_000);
  const statusTimer = setInterval(() => void runStatus(), config.syncIntervalMs);
  void runner.poll();
  void runStatus();

  const shutdown = async (signal: string) => {
    log.info(`Received ${signal}, finishing running jobs…`);
    clearInterval(jobTimer);
    clearInterval(staleTimer);
    clearInterval(heartbeatTimer);
    clearInterval(statusTimer);
    await runner.drain();
    log.info('Agent stopped');
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err: unknown) => {
  if (err instanceof ConfigError) log.error(err.message);
  else if (err instanceof Error && /fetch failed/i.test(err.message))
    log.error('Cannot reach Supabase. Check the internet connection and SUPABASE_URL.');
  else log.error(err instanceof Error ? err.message : String(err));
  // Exit non-zero so PM2 / systemd / NSSM restart the agent.
  process.exit(1);
});
