import type { SupabaseClient } from '@supabase/supabase-js';
import type { AgentConfig } from '../config.js';
import { log } from '../logger.js';
import { ensureProfile, loadPlan } from '../plans.js';
import { RouterError, type RouterOSClient } from '../routeros.js';
import { toRouterOsTime } from '../routerTime.js';
import { clientFor, loadRouter } from '../routers.js';
import type { JobContext, JobOutcome, RouterJob } from '../types.js';

const CHUNK = 50;

interface HotspotUser {
  '.id': string;
  name: string;
  comment?: string;
}

/** Looks up one hotspot user by name (used after a "name already exists" race). */
async function findUser(client: RouterOSClient, name: string): Promise<HotspotUser | undefined> {
  const users = await client.get<HotspotUser[]>('/ip/hotspot/user', { name, '.proplist': '.id,name,comment' });
  return users[0];
}

/**
 * Adds every not-yet-pushed unused voucher of payload.batch_id to the router as a hotspot user.
 * Idempotent: users already on the router with comment "hzc:<voucher_id>" are only marked as pushed,
 * so running the job twice never creates duplicates. Progress is saved after every 50 vouchers.
 */
export async function runPushVouchers(
  supabase: SupabaseClient,
  config: AgentConfig,
  job: RouterJob,
  ctx: JobContext,
): Promise<JobOutcome> {
  const batchId = typeof job.payload['batch_id'] === 'string' ? job.payload['batch_id'] : null;
  if (!batchId) return { ok: false, result: { error: 'The job has no batch.' } };

  const { data: batch, error: batchError } = await supabase
    .from('voucher_batches')
    .select('id, router_id, plan_id, quantity')
    .eq('id', batchId)
    .maybeSingle();
  if (batchError) throw new Error(`Could not load batch: ${batchError.message}`);
  if (!batch) return { ok: false, result: { error: 'This batch no longer exists.' } };

  const router = await loadRouter(supabase, batch.router_id);
  if (!router) return { ok: false, result: { error: 'This router has been removed.' } };
  const plan = await loadPlan(supabase, batch.plan_id);
  if (!plan) return { ok: false, result: { error: 'This plan no longer exists.' } };

  const client = clientFor(router, config);
  await ensureProfile(client, plan);

  // One read of the router's users, so each voucher needs a single PUT at most.
  const existingUsers = await client.get<HotspotUser[]>('/ip/hotspot/user', { '.proplist': '.id,name,comment' });
  const byName = new Map(existingUsers.map((u) => [u.name, u]));

  const limitUptime = toRouterOsTime(plan.uptime_seconds);
  const limitBytes = plan.data_limit_mb ? String(plan.data_limit_mb * 1024 * 1024) : null;

  let added = 0;
  let alreadyThere = 0;
  const conflicts: string[] = [];
  let lastId = '00000000-0000-0000-0000-000000000000';

  for (;;) {
    const { data: chunk, error } = await supabase
      .from('vouchers')
      .select('id, code')
      .eq('batch_id', batchId)
      .eq('on_router', false)
      .eq('status', 'unused')
      .gt('id', lastId)
      .order('id')
      .limit(CHUNK);
    if (error) throw new Error(`Could not load vouchers: ${error.message}`);
    if (!chunk || chunk.length === 0) break;

    const pushedIds: string[] = [];
    const conflictIds: string[] = [];
    try {
      for (const voucher of chunk) {
        const tag = `hzc:${voucher.id}`;
        let user = byName.get(voucher.code);
        if (!user) {
          try {
            await client.put('/ip/hotspot/user', {
              name: voucher.code,
              password: voucher.code,
              profile: plan.router_profile_name,
              server: router.hotspot_server,
              'limit-uptime': limitUptime,
              ...(limitBytes ? { 'limit-bytes-total': limitBytes } : {}),
              comment: tag,
            });
            added++;
            pushedIds.push(voucher.id);
            continue;
          } catch (err) {
            // Someone added the same name between our read and this write: check whose it is.
            if (!(err instanceof RouterError && err.kind === 'api' && /already/i.test(err.message))) throw err;
            user = await findUser(client, voucher.code);
            if (!user) throw err;
          }
        }
        if (user.comment === tag) {
          alreadyThere++;
          pushedIds.push(voucher.id);
        } else {
          // The code belongs to another hotspot user on this router; never touch it.
          conflicts.push(voucher.code);
          conflictIds.push(voucher.id);
        }
      }
    } finally {
      // Save progress even when the router drops mid-chunk, so the batch shows what is really on the router.
      if (pushedIds.length) {
        const { error: updateError } = await supabase.from('vouchers').update({ on_router: true }).in('id', pushedIds);
        if (updateError) throw new Error(`Could not save push progress: ${updateError.message}`);
      }
      if (conflictIds.length) {
        await supabase.from('vouchers').update({ status: 'disabled' }).in('id', conflictIds).eq('on_router', false);
      }
    }
    await ctx.heartbeat();
    lastId = chunk[chunk.length - 1]?.id ?? lastId;
  }

  log.info('Vouchers pushed', { router: router.name, batch: batchId, added, alreadyThere, conflicts: conflicts.length });
  return {
    ok: true,
    result: {
      added,
      already_on_router: alreadyThere,
      conflicts,
      ...(conflicts.length
        ? { warning: `${conflicts.length} code(s) already belonged to other hotspot users on ${router.name} and were disabled.` }
        : {}),
    },
  };
}
