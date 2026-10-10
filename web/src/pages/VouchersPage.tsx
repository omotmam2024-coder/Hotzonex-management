import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { PageHeader } from '../components/PageHeader';
import { Alert, Badge, Button, Card, Field, Select, Spinner, TextInput } from '../components/ui';
import { friendlyError } from '../lib/errors';
import { formatJubaTime, formatNumber } from '../lib/format';
import { usePlans, useRouters } from '../lib/queries';
import { supabase } from '../lib/supabase';
import type { Voucher, VoucherStatus } from '../lib/types';

const PAGE_SIZE = 50;
const VOUCHER_COLUMNS = 'id, created_at, batch_id, router_id, site_id, plan_id, code, status, on_router, printed_at, sold_at, first_used_at, expires_at';

const STATUS_BADGE: Record<VoucherStatus, { color: 'green' | 'red' | 'gray' | 'blue'; label: string }> = {
  unused: { color: 'gray', label: 'Unused' },
  sold: { color: 'blue', label: 'Sold' },
  active: { color: 'green', label: 'Active' },
  expired: { color: 'red', label: 'Expired' },
  disabled: { color: 'red', label: 'Disabled' },
};

interface BatchOption {
  id: string;
  created_at: string;
  quantity: number;
  plan_name: string;
  router_name: string;
}

export function VouchersPage() {
  const [params, setParams] = useSearchParams();
  const routers = useRouters();
  const plans = usePlans();
  const routerId = params.get('router') ?? '';
  const planId = params.get('plan') ?? '';
  const status = params.get('status') ?? '';
  const batchId = params.get('batch') ?? '';
  const code = params.get('code') ?? '';
  const page = Math.max(0, Number(params.get('page') ?? '0') || 0);
  const [codeInput, setCodeInput] = useState(code);

  useEffect(() => setCodeInput(code), [code]);

  function setFilter(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setParams(next, { replace: true });
  }

  // Search as the user types, after a short pause.
  useEffect(() => {
    const digits = codeInput.replace(/\D/g, '');
    if (digits === code) return;
    const t = setTimeout(() => setFilter('code', digits), 350);
    return () => clearTimeout(t);
  }, [codeInput]);

  const batches = useQuery({
    queryKey: ['batch-options'],
    queryFn: async (): Promise<BatchOption[]> => {
      const { data, error } = await supabase
        .from('voucher_batch_status')
        .select('id, created_at, quantity, plan_name, router_name')
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw new Error(error.message);
      return (data ?? []) as BatchOption[];
    },
  });

  const vouchers = useQuery({
    queryKey: ['vouchers', routerId, planId, status, batchId, code, page],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      let q = supabase.from('vouchers').select(VOUCHER_COLUMNS, { count: 'exact' });
      if (routerId) q = q.eq('router_id', routerId);
      if (planId) q = q.eq('plan_id', planId);
      if (status) q = q.eq('status', status);
      if (batchId) q = q.eq('batch_id', batchId);
      if (code) q = q.like('code', `${code}%`);
      const { data, error, count } = await q
        .order('created_at', { ascending: false })
        .order('code')
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
      if (error) throw new Error(error.message);
      return { rows: (data ?? []) as Voucher[], total: count ?? 0 };
    },
  });

  const planById = new Map((plans.data ?? []).map((p) => [p.id, p]));
  const routerById = new Map((routers.data ?? []).map((r) => [r.id, r]));
  const total = vouchers.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasFilters = Boolean(routerId || planId || status || batchId || code);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Vouchers"
        actions={
          <div className="flex flex-wrap gap-2">
            <Link
              to={batchId ? `/vouchers/print?batch=${batchId}` : '/vouchers/print'}
              className="inline-flex min-h-11 items-center rounded-xl bg-white px-4 font-semibold text-slate-800 ring-1 ring-slate-300 hover:bg-slate-50"
            >
              Print cards
            </Link>
            <Link to="/vouchers/generate" className="inline-flex min-h-11 items-center rounded-xl bg-brand-600 px-4 font-semibold text-white hover:bg-brand-700">
              + Generate vouchers
            </Link>
          </div>
        }
      />

      <Card>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="Search code">
            <TextInput inputMode="numeric" placeholder="Type digits…" value={codeInput} onChange={(e) => setCodeInput(e.target.value)} />
          </Field>
          <Field label="Router">
            <Select value={routerId} onChange={(e) => setFilter('router', e.target.value)}>
              <option value="">All routers</option>
              {(routers.data ?? []).map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Plan">
            <Select value={planId} onChange={(e) => setFilter('plan', e.target.value)}>
              <option value="">All plans</option>
              {(plans.data ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Status">
            <Select value={status} onChange={(e) => setFilter('status', e.target.value)}>
              <option value="">All statuses</option>
              {(Object.keys(STATUS_BADGE) as VoucherStatus[]).map((s) => (
                <option key={s} value={s}>
                  {STATUS_BADGE[s].label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Batch">
            <Select value={batchId} onChange={(e) => setFilter('batch', e.target.value)}>
              <option value="">All batches</option>
              {(batches.data ?? []).map((b) => (
                <option key={b.id} value={b.id}>
                  {formatJubaTime(b.created_at)} · {b.quantity} × {b.plan_name} · {b.router_name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {hasFilters && (
          <button type="button" className="mt-3 text-sm font-semibold text-brand-700 hover:underline" onClick={() => setParams({}, { replace: true })}>
            Clear filters
          </button>
        )}
      </Card>

      {vouchers.error && <Alert tone="error">{friendlyError(vouchers.error)}</Alert>}

      <Card className="!p-0">
        <div className="flex items-center justify-between px-4 py-3 text-sm text-slate-600">
          <span>
            {vouchers.isFetching && <Spinner className="mr-2 h-4 w-4 align-[-2px] text-brand-600" />}
            {formatNumber(total)} voucher{total === 1 ? '' : 's'}
          </span>
          <span>
            Page {page + 1} of {pages}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[700px] text-left text-sm">
            <thead className="border-y border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2">Code</th>
                <th className="px-4 py-2">Plan</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">On router</th>
                <th className="px-4 py-2">Router</th>
                <th className="px-4 py-2">Printed</th>
                <th className="px-4 py-2">Sold</th>
                <th className="px-4 py-2">
                  <span className="sr-only">Receipt</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {(vouchers.data?.rows ?? []).map((v) => {
                const plan = planById.get(v.plan_id);
                const badge = STATUS_BADGE[v.status];
                return (
                  <tr key={v.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-4 py-2 font-mono text-base font-semibold tracking-wider">{v.code}</td>
                    <td className="px-4 py-2">
                      <span className="flex items-center gap-2">
                        <span className="h-3 w-3 rounded-full" style={{ backgroundColor: plan?.color ?? '#94a3b8' }} />
                        {plan?.name ?? '—'}
                      </span>
                    </td>
                    <td className="px-4 py-2">
                      <Badge color={badge.color}>{badge.label}</Badge>
                    </td>
                    <td className="px-4 py-2">{v.on_router ? 'Yes' : <span className="text-amber-700">Not yet</span>}</td>
                    <td className="px-4 py-2">{routerById.get(v.router_id)?.name ?? '—'}</td>
                    <td className="px-4 py-2">{v.printed_at ? formatJubaTime(v.printed_at) : '—'}</td>
                    <td className="px-4 py-2">{v.sold_at ? formatJubaTime(v.sold_at) : '—'}</td>
                    <td className="px-4 py-2 text-right">
                      {v.on_router && v.status !== 'disabled' && (
                        <Link to={`/print/receipt/${v.id}`} className="font-semibold text-brand-700 hover:underline">
                          Receipt
                        </Link>
                      )}
                    </td>
                  </tr>
                );
              })}
              {vouchers.data && vouchers.data.rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-6 text-center text-slate-500">
                    No vouchers match these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {pages > 1 && (
          <div className="flex justify-between gap-2 p-3">
            <Button variant="secondary" disabled={page === 0} onClick={() => setFilter('page', String(page - 1))}>
              ← Previous
            </Button>
            <Button variant="secondary" disabled={page + 1 >= pages} onClick={() => setFilter('page', String(page + 1))}>
              Next →
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
