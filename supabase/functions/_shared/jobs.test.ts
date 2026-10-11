// Run with: node --test supabase/functions/_shared/jobs.test.ts   (Node 22.18+)
// Deletes in both directions, against a small in-memory stand-in for the database client.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.117.3';
import { applyRouterRemovals, finishProfileRemoval, finishVoucherDelete, retireRemovedProfiles, type Job, type RouterRef } from './jobs.ts';

type Row = Record<string, unknown>;

/** Just enough of the supabase-js query builder for jobs.ts: filters, paging, counts and writes. */
function fakeDb(tables: Record<string, Row[]>): SupabaseClient {
  let nextId = 1;
  const from = (table: string) => {
    const rows = (tables[table] ??= []);
    const filters: ((r: Row) => boolean)[] = [];
    let op: 'select' | 'update' | 'delete' | 'insert' = 'select';
    let changes: Row = {};
    let inserted: Row[] = [];
    let range: [number, number] | null = null;
    let head = false;
    let single = false;
    const run = () => {
      if (op === 'insert') {
        rows.push(...inserted.map((r) => ({ id: `new-${nextId++}`, ...r })));
        return { data: null, error: null };
      }
      const hit = rows.filter((r) => filters.every((f) => f(r)));
      if (op === 'update') hit.forEach((r) => Object.assign(r, changes));
      if (op === 'delete') hit.forEach((r) => rows.splice(rows.indexOf(r), 1));
      if (head) return { data: null, count: hit.length, error: null };
      const out = range ? hit.slice(range[0], range[1] + 1) : hit;
      return { data: single ? (out[0] ?? null) : out, error: null };
    };
    const b = {
      select: (_cols?: string, opts?: { head?: boolean }) => ((head = Boolean(opts?.head)), b),
      update: (c: Row) => ((op = 'update'), (changes = c), b),
      delete: () => ((op = 'delete'), b),
      insert: (r: Row | Row[]) => ((op = 'insert'), (inserted = Array.isArray(r) ? r : [r]), b),
      eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), b),
      in: (k: string, v: unknown[]) => (filters.push((r) => v.includes(r[k])), b),
      order: () => b,
      range: (a: number, z: number) => ((range = [a, z]), b),
      maybeSingle: () => ((single = true), b),
      then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(run()).then(ok, bad),
    };
    return b;
  };
  return { from } as unknown as SupabaseClient;
}

const T = 'tenant-1';
const router: RouterRef = { id: 'r1', tenant_id: T, name: 'Main', status: 'online', host: null, hotspot_server: 'hotspot1', dns_name: null, last_usage_at: null };

function world() {
  return {
    vouchers: [
      { id: 'v1', code: '1111', status: 'unused', on_router: true, router_id: 'r1', batch_id: 'b1', plan_id: 'p1' },
      { id: 'v2', code: '2222', status: 'sold', on_router: true, router_id: 'r1', batch_id: 'b1', plan_id: 'p1' },
      { id: 'v3', code: '3333', status: 'unused', on_router: true, router_id: 'r1', batch_id: 'b2', plan_id: 'p1' },
      { id: 'v4', code: '4444', status: 'unused', on_router: false, router_id: 'r1', batch_id: 'b2', plan_id: 'p1' },
    ],
    voucher_batches: [{ id: 'b1' }, { id: 'b2' }],
    sales: [{ id: 's1', voucher_id: 'v2', plan_id: 'p1' }],
    router_logins: [
      { id: 'l1', router_id: 'r1', username: 'mt-unused-gone', used: false },
      { id: 'l2', router_id: 'r1', username: 'mt-used-gone', used: true },
      { id: 'l3', router_id: 'r1', username: 'mt-unused-here', used: false },
    ],
    audit_log: [] as Row[],
    plans: [] as Row[],
    routers: [] as Row[],
    router_jobs: [] as Row[],
  };
}

test('users deleted on the router are deleted in Hotzonex; sold vouchers and sales records stay', async () => {
  const t = world();
  const db = fakeDb(t);
  // v1 (unused) and v2 (sold) were deleted on the router; v3 is still there; v4 was never pushed.
  const r = await applyRouterRemovals(db, router, new Set(['3333', 'mt-unused-here', 'someone']));
  assert.deepEqual(r, { vouchers_deleted: 1, vouchers_disabled: 1, records_deleted: 1 });
  assert.deepEqual(t.vouchers.map((v) => v.id), ['v2', 'v3', 'v4']);
  assert.deepEqual(t.vouchers[0], { ...t.vouchers[0], status: 'disabled', on_router: false }, 'sold voucher kept, switched off');
  assert.deepEqual(t.voucher_batches.map((b) => b.id), ['b1', 'b2'], 'batches with vouchers left are kept');
  assert.deepEqual(t.router_logins.map((l) => l.id), ['l2', 'l3'], 'used MikroTicket records are sales: kept');
  assert.equal(t.audit_log.length, 1);
});

test('an empty user list is treated as a failed read: nothing is deleted', async () => {
  const t = world();
  assert.equal(await applyRouterRemovals(fakeDb(t), router, new Set()), null);
  assert.equal(t.vouchers.length, 4);
  assert.equal(t.router_logins.length, 3);
});

test('vouchers deleted in Hotzonex: rows go after the router, and an empty batch goes too', async () => {
  const t = world();
  t.sales = [];
  const job = { id: 'j1', payload: { delete: true, vouchers: [{ id: 'v3', code: '3333' }, { id: 'v4', code: '4444' }] } } as unknown as Job;
  t.router_jobs.push({ id: 'j1', status: 'running' });
  await finishVoucherDelete(fakeDb(t), job, 1);
  assert.deepEqual(t.vouchers.map((v) => v.id), ['v1', 'v2']);
  assert.deepEqual(t.voucher_batches.map((b) => b.id), ['b1']);
  assert.equal(t.router_jobs[0]!.status, 'done');
});

test('a profile deleted on the router retires its plan: deleted when unused, switched off when it has sales', async () => {
  const t = world();
  t.plans = [
    { id: 'pa', tenant_id: T, router_profile_name: 'profile_A', is_active: true },
    { id: 'p1', tenant_id: T, router_profile_name: 'profile_B', is_active: true },
    { id: 'pc', tenant_id: T, router_profile_name: 'profile_C', is_active: true },
    { id: 'ph', tenant_id: T, router_profile_name: 'hzc-1h', is_active: true },
  ];
  // profile_C is still on another router of the business.
  t.routers = [
    { id: 'r1', tenant_id: T, hotspot_info: { user_profiles: [{ name: 'default' }] } },
    { id: 'r2', tenant_id: T, hotspot_info: { user_profiles: [{ name: 'profile_C' }] } },
  ];
  const db = fakeDb(t);
  const out = await retireRemovedProfiles(db, router, ['default', 'profile_A', 'profile_B', 'profile_C', 'hzc-1h'], ['default']);
  assert.deepEqual(out, { profile_A: 'deleted', profile_B: 'switched_off', profile_C: 'kept' });
  assert.deepEqual(t.plans.map((p) => [p.id, p.is_active]), [['p1', false], ['pc', true], ['ph', true]], "Hotzonex's own hzc- plans are left alone");
  assert.deepEqual(await retireRemovedProfiles(db, router, ['default', 'profile_C'], []), {}, 'an empty list is a failed read');
});

test('deleting a plan in Hotzonex: kept (switched off) while users are on its profile, deleted once it is gone', async () => {
  const t = world();
  t.plans = [{ id: 'pa', tenant_id: T, router_profile_name: 'Guest', is_active: false }];
  t.routers = [{ id: 'r1', tenant_id: T, hotspot_info: { user_profiles: [{ name: 'default' }, { name: 'Guest' }] } }];
  t.router_jobs = [{ id: 'j1', status: 'running' }, { id: 'j2', status: 'running' }];
  const db = fakeDb(t);
  const job = (id: string) => ({ id, payload: { remove_profile: 'Guest', plan_id: 'pa' } }) as unknown as Job;

  await finishProfileRemoval(db, router, job('j1'), 3);
  assert.equal(t.router_jobs[0]!.status, 'failed');
  assert.match(String((t.router_jobs[0]!.result as Row).error), /3 hotspot user/);
  assert.equal(t.plans.length, 1);

  await finishProfileRemoval(db, router, job('j2'), 0);
  assert.equal(t.router_jobs[1]!.status, 'done');
  assert.deepEqual(t.plans, []);
  assert.deepEqual(t.routers[0]!.hotspot_info, { user_profiles: [{ name: 'default' }] });
});
