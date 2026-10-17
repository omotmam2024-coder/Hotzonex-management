import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../auth/AuthProvider';
import { PageHeader } from '../../components/PageHeader';
import { Alert, Badge, Button, buttonClass, Card, Field, Select, Spinner, TextInput, textButtonClass } from '../../components/ui';
import { friendlyError } from '../../lib/errors';
import { formatJubaTime, formatNumber, formatSSP, jubaToday } from '../../lib/format';
import { invalidateSalesData, usePlans, useRouters, useSites } from '../../hooks/queries';
import { supabase } from '../../lib/supabase';
import type { ReceiptData } from '../../print/Receipt';
import { hotspotAddress } from '../../lib/routers';
import { useT } from '../../i18n';

const PAGE_SIZE = 100;
const VOID_WINDOW_MS = 24 * 3600 * 1000;

export interface SaleListRow {
  sale_id: string;
  sold_at: string;
  /** null for a router voucher (e.g. MikroTicket) counted when it was activated on the router. */
  voucher_id: string | null;
  code: string;
  plan_id: string | null;
  plan_name: string;
  plan_color: string;
  amount_ssp: number;
  seller_id: string | null;
  seller_name: string;
  site_id: string;
  site_name: string;
  router_id: string;
  voided_at: string | null;
  void_reason: string | null;
  voided_by_name: string | null;
  total_rows: number;
  total_sold: number;
  total_ssp: number;
}

interface StaffOption {
  id: string;
  full_name: string;
  site_id: string | null;
}

function VoidDialog({ sale, onClose }: { sale: SaleListRow; onClose: () => void }) {
  const { t } = useT();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  // A double tap must not send the void twice.
  const inFlight = useRef(false);
  const voidSale = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('void_sale', { p_sale_id: sale.sale_id, p_reason: reason.trim() });
      if (error) throw new Error(friendlyError(error));
    },
    onSuccess: () => {
      invalidateSalesData(queryClient);
      onClose();
    },
  });
  function confirmVoid() {
    if (inFlight.current) return;
    inFlight.current = true;
    voidSale.mutate(undefined, { onSettled: () => (inFlight.current = false) });
  }
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/50 p-4 sm:items-center" role="dialog" aria-label={t('sales.void.title')}>
      <Card className="w-full max-w-md">
        <h2 className="text-lg font-bold">{t('sales.void.title')}</h2>
        <p className="mt-1 text-slate-600">
          {t('sales.void.code')} <strong className="font-mono">{sale.code}</strong> · {sale.plan_name} · {formatSSP(sale.amount_ssp)} · {formatJubaTime(sale.sold_at)}
        </p>
        <p className="mt-2 text-sm text-slate-600">{t('sales.void.text')}</p>
        <div className="mt-4">
          <Field label={t('sales.void.reason')}>
            <TextInput value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder={t('sales.void.reasonPlaceholder')} autoFocus />
          </Field>
        </div>
        {voidSale.error && (
          <div className="mt-3">
            <Alert tone="error">{voidSale.error.message}</Alert>
          </div>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="danger" disabled={reason.trim().length < 3 || voidSale.isPending} onClick={confirmVoid}>
            {voidSale.isPending && <Spinner />} {t('sales.void.title')}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
        </div>
      </Card>
    </div>
  );
}

export function SalesPage() {
  const { t, dir } = useT();
  const { profile } = useAuth();
  const navigate = useNavigate();
  const isSeller = profile?.role === 'seller';
  const isAdmin = profile?.role === 'admin';
  const sites = useSites();
  const plans = usePlans();
  const routers = useRouters();
  // Worked out on every render so "My sales today" rolls over at midnight (the list refetches every 30 s).
  const today = jubaToday();
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [siteId, setSiteId] = useState('');
  const [planId, setPlanId] = useState('');
  const [sellerId, setSellerId] = useState('');
  const [page, setPage] = useState(0);
  const [voiding, setVoiding] = useState<SaleListRow | null>(null);

  const staff = useQuery({
    queryKey: ['staff-options'],
    enabled: !isSeller,
    queryFn: async (): Promise<StaffOption[]> => {
      const { data, error } = await supabase.from('profiles').select('id, full_name, site_id').order('full_name');
      if (error) throw new Error(friendlyError(error));
      return data ?? [];
    },
  });

  // A cashier always sees today; others see the chosen period.
  const dateFrom = isSeller ? today : from;
  const dateTo = isSeller ? today : to;
  const sales = useQuery({
    queryKey: ['sales', dateFrom, dateTo, siteId, planId, sellerId, page],
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
    queryFn: async (): Promise<SaleListRow[]> => {
      const { data, error } = await supabase.rpc('list_sales', {
        p_date_from: dateFrom,
        p_date_to: dateTo,
        p_site_id: siteId || null,
        p_plan_id: planId || null,
        p_seller_id: sellerId || null,
        p_limit: PAGE_SIZE,
        p_offset: page * PAGE_SIZE,
      });
      if (error) throw new Error(friendlyError(error));
      return data ?? [];
    },
  });

  const rows = sales.data ?? [];
  const first = rows[0];
  const totalRows = first?.total_rows ?? 0;
  const pages = Math.max(1, Math.ceil(totalRows / PAGE_SIZE));
  const voidedCount = totalRows - (first?.total_sold ?? 0);

  function reprint(row: SaleListRow) {
    const plan = plans.data?.find((p) => p.id === row.plan_id);
    const router = routers.data?.find((r) => r.id === row.router_id);
    const receipt: ReceiptData = {
      code: row.code,
      siteName: row.site_name,
      dnsName: router?.dns_name ?? '',
      hotspotIp: hotspotAddress(router),
      planName: row.plan_name,
      planColor: row.plan_color,
      priceSsp: row.amount_ssp,
      uptimeSeconds: plan?.uptime_seconds ?? 0,
      soldAt: row.sold_at,
      sellerName: row.seller_name,
    };
    navigate('/print/receipt', { state: { receipt } });
  }

  const resetPage = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v);
    setPage(0);
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title={isSeller ? t('sales.titleMine') : t('sales.title')}
        subtitle={isSeller ? undefined : t('sales.subtitle')}
        actions={
          !isSeller && (
            <Link to="/sales/mark-sold" className={buttonClass('secondary')}>
              {t('sales.markSold')}
            </Link>
          )
        }
      />

      {!isSeller && (
        <Card>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Field label={t('sales.from')}>
              <TextInput type="date" value={from} max={to} onChange={(e) => resetPage(setFrom)(e.target.value || today)} />
            </Field>
            <Field label={t('sales.to')}>
              <TextInput type="date" value={to} min={from} onChange={(e) => resetPage(setTo)(e.target.value || today)} />
            </Field>
            {isAdmin && (
              <Field label={t('common.site')}>
                <Select value={siteId} onChange={(e) => resetPage(setSiteId)(e.target.value)}>
                  <option value="">{t('common.allSites')}</option>
                  {(sites.data ?? []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <Field label={t('common.plan')}>
              <Select value={planId} onChange={(e) => resetPage(setPlanId)(e.target.value)}>
                <option value="">{t('common.allPlans')}</option>
                {(plans.data ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('role.seller')}>
              <Select value={sellerId} onChange={(e) => resetPage(setSellerId)(e.target.value)}>
                <option value="">{t('sales.allCashiers')}</option>
                {(staff.data ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.full_name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Card>
          <div className="text-sm text-slate-500">{t('sales.soldActivated')}</div>
          <div className="text-xl font-bold tabular-nums sm:text-3xl">{formatNumber(first?.total_sold ?? 0)}</div>
        </Card>
        <Card>
          <div className="text-sm text-slate-500">{t('common.revenue')}</div>
          <div className="text-xl font-bold tabular-nums sm:text-3xl">{formatSSP(first?.total_ssp ?? 0)}</div>
        </Card>
        {voidedCount > 0 && (
          <Card>
            <div className="text-sm text-slate-500">{t('sales.voided')}</div>
            <div className="text-xl font-bold tabular-nums sm:text-3xl text-red-700">{formatNumber(voidedCount)}</div>
          </Card>
        )}
      </div>

      {!isSeller && (
        <p className="text-sm text-slate-600">
          {t('sales.includesNote')}
        </p>
      )}
      {sales.error && <Alert tone="error">{friendlyError(sales.error)}</Alert>}

      <Card className="!p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-start text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2">{t('sales.col.time')}</th>
                <th className="px-4 py-2">{t('sales.col.code')}</th>
                <th className="px-4 py-2">{t('common.plan')}</th>
                <th className="px-4 py-2 text-end">{t('common.amount')}</th>
                <th className="px-4 py-2">{t('role.seller')}</th>
                <th className="px-4 py-2">{t('common.site')}</th>
                <th className="px-4 py-2">
                  <span className="sr-only">{t('sales.col.actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => {
                const canVoid = isAdmin && s.voucher_id !== null && !s.voided_at && Date.now() - new Date(s.sold_at).getTime() < VOID_WINDOW_MS;
                return (
                  <tr key={s.sale_id} className={`border-b border-slate-100 last:border-0 ${s.voided_at ? 'bg-red-50/50' : ''}`}>
                    <td className="whitespace-nowrap px-4 py-2">{formatJubaTime(s.sold_at)}</td>
                    <td className="px-4 py-2 font-mono text-base font-semibold tracking-wider">{s.code}</td>
                    <td className="px-4 py-2">
                      <span className="flex items-center gap-2">
                        <span className="h-3 w-3 rounded-full" style={{ backgroundColor: s.plan_color }} />
                        {s.plan_name}
                      </span>
                    </td>
                    <td className={`whitespace-nowrap px-4 py-2 text-end font-semibold tabular-nums ${s.voided_at ? 'text-slate-500 line-through' : ''}`}>{formatSSP(s.amount_ssp)}</td>
                    <td className="px-4 py-2">{s.seller_name}</td>
                    <td className="px-4 py-2">{s.site_name}</td>
                    <td className="px-4 py-2">
                      <div className="flex items-center justify-end gap-1">
                        {s.voided_at ? (
                          <span title={`${s.void_reason ?? ''} — ${s.voided_by_name ?? ''}`}>
                            <Badge color="red">{t('sales.voided')}</Badge>
                            <span className="ms-2 text-xs text-slate-500">{s.void_reason}</span>
                          </span>
                        ) : s.voucher_id !== null ? (
                          <button type="button" onClick={() => reprint(s)} className={`${textButtonClass} text-brand-700`}>
                            {t('sales.receipt')}
                          </button>
                        ) : null}
                        {canVoid && (
                          <button type="button" onClick={() => setVoiding(s)} className={`${textButtonClass} text-red-700`}>
                            {t('sales.void')}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {sales.data && rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                    {t('sales.empty')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {sales.isLoading && <Spinner className="m-4 h-6 w-6 text-brand-600" />}
        {pages > 1 && (
          <div className="flex items-center justify-between gap-2 p-3">
            <Button variant="secondary" disabled={page === 0} onClick={() => setPage(page - 1)}>
              {dir === 'rtl' ? '→' : '←'} {t('sales.previous')}
            </Button>
            <span className="text-sm text-slate-600">
              {t('sales.pageOf', { page: page + 1, pages })}
            </span>
            <Button variant="secondary" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>
              {t('sales.next')} {dir === 'rtl' ? '←' : '→'}
            </Button>
          </div>
        )}
      </Card>

      {voiding && <VoidDialog sale={voiding} onClose={() => setVoiding(null)} />}
    </div>
  );
}
