import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../auth/AuthProvider';
import { PageHeader } from '../../components/PageHeader';
import { Alert, Badge, Button, buttonClass, Card, Field, Select, Spinner, TextInput, textButtonClass } from '../../components/ui';
import { friendlyError } from '../../lib/errors';
import { formatJubaTime, formatNumber } from '../../lib/format';
import { invokeFunction } from '../../lib/functions';
import { translate, useT } from '../../i18n';
import { invalidateSalesData, usePlans, useRouters } from '../../hooks/queries';
import { VOUCHER_STATUS } from '../../lib/labels';
import { supabase } from '../../lib/supabase';
import type { Voucher, VoucherStatus } from '../../lib/types';

const PAGE_SIZE = 50;
const VOUCHER_COLUMNS = 'id, created_at, batch_id, router_id, site_id, plan_id, code, status, on_router, printed_at, sold_at, first_used_at, expires_at';

/** Sold and in-use vouchers have sales, so they stay; the rest can be deleted (from the router too). */
const DELETABLE: VoucherStatus[] = ['unused', 'disabled', 'expired'];

interface DeleteResult {
  deleted: number;
  removing: number;
  kept: number;
}

function deleteMessage(r: DeleteResult): string {
  const parts = [];
  if (r.deleted) parts.push(translate('vouchers.del.deleted', { n: r.deleted }));
  if (r.removing) parts.push(translate('vouchers.del.removing', { n: r.removing }));
  if (r.kept) parts.push(translate('vouchers.del.kept', { n: r.kept }));
  return parts.length ? `${parts.join('; ')}.` : translate('vouchers.del.nothing');
}

interface BatchOption {
  id: string;
  created_at: string;
  quantity: number;
  plan_name: string;
  router_name: string;
}

export function VouchersPage() {
  const { t, dir } = useT();
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
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => setCodeInput(code), [code]);

  const setFilter = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(params);
      if (value) next.set(key, value);
      else next.delete(key);
      if (key !== 'page') next.delete('page');
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  // Search as the user types, after a short pause.
  useEffect(() => {
    const digits = codeInput.replace(/\D/g, '');
    if (digits === code) return;
    const t = setTimeout(() => setFilter('code', digits), 350);
    return () => clearTimeout(t);
  }, [codeInput, code, setFilter]);

  const batches = useQuery({
    queryKey: ['batch-options'],
    queryFn: async (): Promise<BatchOption[]> => {
      const { data, error } = await supabase
        .from('voucher_batch_status')
        .select('id, created_at, quantity, plan_name, router_name')
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw new Error(friendlyError(error));
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
      if (error) throw new Error(friendlyError(error));
      return { rows: (data ?? []) as Voucher[], total: count ?? 0 };
    },
  });

  // A new page or filter starts with nothing selected.
  useEffect(() => setSelected(new Set()), [routerId, planId, status, batchId, code, page]);

  const remove = useMutation({
    mutationFn: (ids: string[]) => invokeFunction<DeleteResult>('delete-items', { action: 'delete_vouchers', ids }),
    onSuccess: () => {
      setSelected(new Set());
      invalidateSalesData(queryClient);
      void queryClient.invalidateQueries({ queryKey: ['batch-options'] });
    },
  });
  function deleteSelected() {
    const ids = [...selected];
    if (!window.confirm(t(ids.length === 1 ? 'vouchers.confirmDeleteOne' : 'vouchers.confirmDeleteMany', { n: ids.length }))) return;
    remove.mutate(ids);
  }

  const planById = new Map((plans.data ?? []).map((p) => [p.id, p]));
  const routerById = new Map((routers.data ?? []).map((r) => [r.id, r]));
  const total = vouchers.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasFilters = Boolean(routerId || planId || status || batchId || code);
  const rows = vouchers.data?.rows ?? [];
  const deletable = rows.filter((v) => DELETABLE.includes(v.status));
  const allPicked = deletable.length > 0 && deletable.every((v) => selected.has(v.id));
  const toggle = (id: string) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('vouchers.title')}
        subtitle={t('vouchers.subtitle')}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link
              to={batchId ? `/vouchers/print?batch=${batchId}` : '/vouchers/print'}
              className={buttonClass('secondary')}
            >
              {t('vouchers.printCards')}
            </Link>
            <Link to="/vouchers/generate" className={buttonClass('primary')}>
              {t('vouchers.generateBtn')}
            </Link>
          </div>
        }
      />

      <Card>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('vouchers.searchCode')}>
            <TextInput inputMode="numeric" dir="ltr" placeholder={t('vouchers.typeDigits')} value={codeInput} onChange={(e) => setCodeInput(e.target.value)} />
          </Field>
          <Field label={t('vouchers.status')}>
            <Select value={status} onChange={(e) => setFilter('status', e.target.value)}>
              <option value="">{t('vouchers.allStatuses')}</option>
              {(Object.keys(VOUCHER_STATUS) as VoucherStatus[]).map((s) => (
                <option key={s} value={s}>
                  {VOUCHER_STATUS[s].label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {/* Router, plan and batch are for finding a group of cards: tucked away until needed. */}
        <details className="mt-3" open={Boolean(routerId || planId || batchId) || undefined}>
          <summary className="flex min-h-11 cursor-pointer items-center font-semibold text-brand-700">{t('vouchers.moreFilters')}</summary>
          <div className="mt-2 grid gap-3 sm:grid-cols-3">
            <Field label={t('common.router')}>
              <Select value={routerId} onChange={(e) => setFilter('router', e.target.value)}>
                <option value="">{t('vouchers.allRouters')}</option>
                {(routers.data ?? []).map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('common.plan')}>
              <Select value={planId} onChange={(e) => setFilter('plan', e.target.value)}>
                <option value="">{t('common.allPlans')}</option>
                {(plans.data ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('vouchers.batch')}>
              <Select value={batchId} onChange={(e) => setFilter('batch', e.target.value)}>
                <option value="">{t('vouchers.allBatches')}</option>
                {(batches.data ?? []).map((b) => (
                  <option key={b.id} value={b.id}>
                    {formatJubaTime(b.created_at)} · {b.quantity} × {b.plan_name} · {b.router_name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </details>
        {hasFilters && (
          <button type="button" className={`${textButtonClass} mt-1 text-brand-700`} onClick={() => setParams({}, { replace: true })}>
            {t('vouchers.clearFilters')}
          </button>
        )}
      </Card>

      {vouchers.error && <Alert tone="error">{friendlyError(vouchers.error)}</Alert>}
      {remove.error && <Alert tone="error">{remove.error.message}</Alert>}
      {remove.data && <Alert tone="success">{deleteMessage(remove.data)}</Alert>}

      <Card className="!p-0">
        <div className="flex items-center justify-between px-4 py-3 text-sm text-slate-600">
          <span>
            {vouchers.isFetching && <Spinner className="me-2 h-4 w-4 align-[-2px] text-brand-600" />}
            {t(total === 1 ? 'vouchers.countOne' : 'vouchers.countMany', { n: formatNumber(total) })}
          </span>
          <span className="flex items-center gap-3">
            {isAdmin && selected.size > 0 && (
              <Button variant="danger" disabled={remove.isPending} onClick={deleteSelected}>
                {remove.isPending ? <Spinner /> : null} {t('vouchers.deleteN', { n: selected.size })}
              </Button>
            )}
            {t('vouchers.pageOf', { page: page + 1, pages })}
          </span>
        </div>
        {/* Phone: one card per voucher, nothing to scroll sideways. */}
        <ul className="divide-y divide-slate-100 border-t border-slate-200 sm:hidden">
          {rows.map((v) => {
            const plan = planById.get(v.plan_id);
            const badge = VOUCHER_STATUS[v.status];
            return (
              <li key={v.id} className="flex items-start gap-3 px-4 py-3">
                {isAdmin && (
                  <input
                    type="checkbox"
                    className="mt-1.5 h-5 w-5 shrink-0"
                    aria-label={t('vouchers.selectCode', { code: v.code })}
                    checked={selected.has(v.id)}
                    disabled={!DELETABLE.includes(v.status)}
                    onChange={() => toggle(v.id)}
                  />
                )}
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span dir="ltr" className="font-mono text-xl font-bold tracking-wider text-slate-900">
                      {v.code}
                    </span>
                    <Badge color={badge.color}>{badge.label}</Badge>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-600">
                    <span className="flex items-center gap-1.5">
                      <span className="h-3 w-3 rounded-full" style={{ backgroundColor: plan?.color ?? '#94a3b8' }} />
                      {plan?.name ?? '—'}
                    </span>
                    <span>{routerById.get(v.router_id)?.name ?? '—'}</span>
                    {v.sold_at && <span>{t('vouchers.soldOn', { time: formatJubaTime(v.sold_at) })}</span>}
                  </div>
                  {!v.on_router && <p className="text-sm font-medium text-amber-700">{t('vouchers.notOnRouterYet')}</p>}
                  {v.on_router && v.status !== 'disabled' && (
                    <Link to={`/print/receipt/${v.id}`} className={`${textButtonClass} text-brand-700`}>
                      {t('vouchers.receiptLink')}
                    </Link>
                  )}
                </div>
              </li>
            );
          })}
          {vouchers.data && vouchers.data.rows.length === 0 && <li className="px-4 py-6 text-center text-slate-500">{t('vouchers.noMatch')}</li>}
        </ul>
        <div className="hidden overflow-x-auto sm:block">
          <table className="w-full min-w-[700px] text-start text-sm">
            <thead className="border-y border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                {isAdmin && (
                  <th className="w-10 px-4 py-2">
                    <input
                      type="checkbox"
                      className="h-5 w-5"
                      aria-label={t('vouchers.selectAll')}
                      checked={allPicked}
                      disabled={!deletable.length}
                      onChange={() => setSelected(allPicked ? new Set() : new Set(deletable.map((v) => v.id)))}
                    />
                  </th>
                )}
                <th className="px-4 py-2">{t('vouchers.col.code')}</th>
                <th className="px-4 py-2">{t('common.plan')}</th>
                <th className="px-4 py-2">{t('vouchers.status')}</th>
                <th className="px-4 py-2">{t('vouchers.col.onRouter')}</th>
                <th className="px-4 py-2">{t('common.router')}</th>
                <th className="px-4 py-2">{t('vouchers.col.printed')}</th>
                <th className="px-4 py-2">{t('vouchers.col.sold')}</th>
                <th className="px-4 py-2">
                  <span className="sr-only">{t('vouchers.receiptLink')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((v) => {
                const plan = planById.get(v.plan_id);
                const badge = VOUCHER_STATUS[v.status];
                return (
                  <tr key={v.id} className="border-b border-slate-100 last:border-0">
                    {isAdmin && (
                      <td className="px-4 py-2">
                        <input
                          type="checkbox"
                          className="h-5 w-5"
                          aria-label={t('vouchers.selectCode', { code: v.code })}
                          title={DELETABLE.includes(v.status) ? undefined : t('vouchers.soldKept')}
                          checked={selected.has(v.id)}
                          disabled={!DELETABLE.includes(v.status)}
                          onChange={() => toggle(v.id)}
                        />
                      </td>
                    )}
                    <td className="px-4 py-2 font-mono text-base font-semibold tracking-wider">
                      <span dir="ltr">{v.code}</span>
                    </td>
                    <td className="px-4 py-2">
                      <span className="flex items-center gap-2">
                        <span className="h-3 w-3 rounded-full" style={{ backgroundColor: plan?.color ?? '#94a3b8' }} />
                        {plan?.name ?? '—'}
                      </span>
                    </td>
                    <td className="px-4 py-2">
                      <Badge color={badge.color}>{badge.label}</Badge>
                    </td>
                    <td className="px-4 py-2">{v.on_router ? t('common.yes') : <span className="text-amber-700">{t('vouchers.notYet')}</span>}</td>
                    <td className="px-4 py-2">{routerById.get(v.router_id)?.name ?? '—'}</td>
                    <td className="px-4 py-2">{v.printed_at ? formatJubaTime(v.printed_at) : '—'}</td>
                    <td className="px-4 py-2">{v.sold_at ? formatJubaTime(v.sold_at) : '—'}</td>
                    <td className="px-4 py-2 text-end">
                      {v.on_router && v.status !== 'disabled' && (
                        <Link to={`/print/receipt/${v.id}`} className={`${textButtonClass} text-brand-700`}>
                          {t('vouchers.receiptLink')}
                        </Link>
                      )}
                    </td>
                  </tr>
                );
              })}
              {vouchers.data && vouchers.data.rows.length === 0 && (
                <tr>
                  <td colSpan={isAdmin ? 9 : 8} className="px-4 py-6 text-center text-slate-500">
                    {t('vouchers.noMatch')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {pages > 1 && (
          <div className="flex justify-between gap-2 p-3">
            <Button variant="secondary" disabled={page === 0} onClick={() => setFilter('page', String(page - 1))}>
              {dir === 'rtl' ? '→' : '←'} {t('vouchers.previous')}
            </Button>
            <Button variant="secondary" disabled={page + 1 >= pages} onClick={() => setFilter('page', String(page + 1))}>
              {t('vouchers.next')} {dir === 'rtl' ? '←' : '→'}
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
