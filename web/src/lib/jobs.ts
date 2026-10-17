import { supabase } from './supabase';
import { translate } from '../i18n/translate';
import type { JobRow } from './types';

export class RouterTimeoutError extends Error {
  constructor() {
    super(translate('msg.routerNoAnswer'));
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Polls a router job until the router finishes it (done or failed). Routers call in every 30 seconds. */
export async function waitForJob(jobId: string, timeoutMs = 75_000, intervalMs = 1500): Promise<JobRow> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { data, error } = await supabase.from('router_jobs').select('id, status, result').eq('id', jobId).maybeSingle<JobRow>();
    if (error) throw new Error(error.message);
    if (data && (data.status === 'done' || data.status === 'failed')) return data;
    await sleep(intervalMs);
  }
  throw new RouterTimeoutError();
}
