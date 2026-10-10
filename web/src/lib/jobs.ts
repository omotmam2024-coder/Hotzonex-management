import { supabase } from './supabase';
import type { JobRow } from './types';

export class AgentTimeoutError extends Error {
  constructor() {
    super('The Router Agent did not answer. Check that the agent computer is on, connected to the internet, and running.');
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Polls a router job until the Router Agent finishes it (done or failed). */
export async function waitForJob(jobId: string, timeoutMs = 60_000, intervalMs = 1500): Promise<JobRow> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { data, error } = await supabase.from('router_jobs').select('id, status, result').eq('id', jobId).maybeSingle<JobRow>();
    if (error) throw new Error(error.message);
    if (data && (data.status === 'done' || data.status === 'failed')) return data;
    await sleep(intervalMs);
  }
  throw new AgentTimeoutError();
}
