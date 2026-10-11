import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthProvider';
import { Alert, Button, Select, Spinner } from '../components/ui';
import { friendlyError } from '../lib/errors';
import { codeGroups, formatDuration, formatJubaTime, formatSSP } from '../lib/format';
import { usePlans, useRouters, useSites } from '../lib/queries';
import { readStored, writeStored } from '../lib/storage';
import { supabase } from '../lib/supabase';
import type { Plan, RouterInfo } from '../lib/types';
import type { ReceiptData } from '../print/Receipt';
import { loginAddress } from '../print/voucherLinks';

const LOW_STOCK = 20;
const LAST_SALE_KEY = 'hzc.lastSale';
const SITE_KEY = 'hzc.sellSite';

interface SaleRow {
  sale_id: string;
  voucher_id: string;
  code: string;
  amount_ssp: number;
  sold_at: string;
}

interface LastSale {
  receipt: ReceiptData;
}

function SaleResult({ sale, onPrint, onNext }: { sale: LastSale; onPrint: () => void; onNext: () => void }) {
  const r = sale.receipt;
  return (
    <div className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-white" role="dialog" aria-label="Voucher sold">
      <div className="px-4 py-5 text-center text-white" style={{ backgroundColor: r.planColor }}>
        <div className="text-3xl font-extrabold tabular-nums sm:text-5xl">{formatSSP(r.priceSsp)}</div>
        <div className="text-2xl font-bold sm:text-3xl">{formatDuration(r.uptimeSeconds)}</div>
      </div>
      <div className="flex flex-1 flex-col items-center justify-center px-4 py-6 text-center">
        <div className="text-lg font-semibold uppercase tracking-wide text-slate-500">WiFi code</div>
        <div className="mt-2 flex flex-wrap justify-center gap-x-[0.35em] font-extrabold leading-none tabular-nums text-slate-900" style={{ fontSize: 'clamp(56px, 17vw, 170px)' }} aria-label={r.code}>
          {codeGroups(r.code).map((g, i) => (
            <span key={i}>{g}</span>
          ))}
        </div>
        <p className="mt-6 text-lg text-slate-700">Username and password are the same code.</p>
        <p className="text-xl font-bold text-slate-900">{loginAddress(r.dnsName)}</p>
      </div>
      <div className="grid gap-3 p-4 sm:grid-cols-2">
        <Button variant="secondary" onClick={onPrint} className="min-h-16 text-xl">
          🖨 Print receipt
        </Button>
        <Button onClick={onNext} className="min-h-16 text-xl">
          Sell another
        </Button>
      </div>
    </div>
  );
}

function PlanButton({ plan, stock, busy, onSell }: { plan: Plan; stock: number | undefined; busy: boolean; onSell: () => void }) {
  const count = stock ?? 0;
  const empty = stock !== undefined && count === 0;
  const low = !empty && count < LOW_STOCK;
  return (
    <button
      type="button"
      onClick={onSell}
      disabled={busy || empty || stock === undefined}
      className="relative flex min-h-36 w-full flex-col items-start justify-between rounded-2xl p-5 text-left text-white shadow-md transition active:scale-[0.98] disabled:cursor-not-allowed"
      style={{ backgroundColor: empty ? '#94a3b8' : plan.color }}
    >
      <div>
        <div className="text-4xl font-extrabold leading-tight tabular-nums">{formatSSP(plan.price_ssp)}</div>
        <div className="text-3xl font-bold">{formatDuration(plan.uptime_seconds)}</div>
        <div className="mt-1 text-base opacity-90">{plan.name}</div>
      </div>
      <div className="mt-3 w-full">
        {stock === undefined ? (
          <span className="text-base opacity-90">Counting…</span>
        ) : empty ? (
          <span className="block rounded-lg bg-white/90 px-3 py-2 text-base font-bold text-slate-800">Out of stock — generate vouchers</span>
        ) : low ? (
          <span className="inline-block rounded-lg bg-amber-300 px-3 py-1 text-lg font-bold text-amber-950">⚠ Only {count} left</span>
        ) : (
          <span className="text-lg font-semibold">{count} left</span>
        )}
      </div>
    </button>
  );
}

export function SellPage() {
  const { profile, siteName: mySiteName } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const sites = useSites();
  const routers = useRouters();
  const plans = usePlans();

  const fixedSite = profile?.site_id ?? null;
  const [siteId, setSiteId] = useState<string>(() => fixedSite ?? readStored<string>('local', SITE_KEY) ?? '');
  const [routerId, setRouterId] = useState('');
  const [lastSale, setLastSale] = useState<LastSale | null>(() => readStored<LastSale>('session', LAST_SALE_KEY));

  useEffect(() => {
    if (!fixedSite && !siteId && sites.data?.length === 1) setSiteId(sites.data[0]?.id ?? '');
  }, [fixedSite, siteId, sites.data]);

  const siteRouters = useMemo(() => (routers.data ?? []).filter((r) => r.site_id === siteId && r.status !== 'pending'), [routers.data, siteId]);
  useEffect(() => {
    if (!siteRouters.some((r) => r.id === routerId)) setRouterId(siteRouters[0]?.id ?? '');
  }, [siteRouters, routerId]);
  const router: RouterInfo | undefined = siteRouters.find((r) => r.id === routerId);
  const siteName = fixedSite ? (mySiteName ?? '') : (sites.data?.find((s) => s.id === siteId)?.name ?? '');

  const stock = useQuery({
    queryKey: ['stock', routerId],
    enabled: Boolean(routerId),
    refetchInterval: 15_000,
    queryFn: async (): Promise<Map<string, number>> => {
      const { data, error } = await supabase.rpc('voucher_stock', { p_router_id: routerId });
      if (error) throw new Error(friendlyError(error));
      return new Map(((data ?? []) as { plan_id: string; available: number }[]).map((r) => [r.plan_id, Number(r.available)]));
    },
  });

  const sell = useMutation({
    mutationFn: async (plan: Plan): Promise<LastSale> => {
      if (!router) throw new Error('Choose a router first.');
      const { data, error } = await supabase.rpc('sell_voucher', { p_router_id: router.id, p_plan_id: plan.id });
      if (error) throw new Error(friendlyError(error));
      const row = (data as SaleRow[] | null)?.[0];
      if (!row) throw new Error('The sale did not return a code. Please try again.');
      return {
        receipt: {
          code: row.code,
          siteName,
          dnsName: router.dns_name ?? '',
          planName: plan.name,
          planColor: plan.color,
          priceSsp: row.amount_ssp,
          uptimeSeconds: plan.uptime_seconds,
          soldAt: row.sold_at,
          sellerName: profile?.full_name ?? null,
        },
      };
    },
    onSuccess: (sale) => {
      setLastSale(sale);
      writeStored('session', LAST_SALE_KEY, sale);
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ['stock', routerId] }),
  });

  function sellAnother() {
    setLastSale(null);
    writeStored('session', LAST_SALE_KEY, null);
    sell.reset();
  }

  function printReceipt() {
    if (lastSale) navigate('/print/receipt?print=1', { state: { receipt: lastSale.receipt } });
  }

  const activePlans = (plans.data ?? []).filter((p) => p.is_active);
  const canGenerate = profile?.role === 'admin' || profile?.role === 'manager';

  return (
    <div className="mx-auto max-w-5xl">
      {lastSale && <SaleResult sale={lastSale} onPrint={printReceipt} onNext={sellAnother} />}

      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Sell</h1>
          <p className="text-slate-600">Cash only · tap a plan to sell one voucher</p>
        </div>
        {!fixedSite && (
          <div className="w-full sm:w-64">
            <Select
              value={siteId}
              aria-label="Site"
              onChange={(e) => {
                setSiteId(e.target.value);
                writeStored('local', SITE_KEY, e.target.value);
              }}
            >
              <option value="">Choose a site…</option>
              {(sites.data ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </div>
        )}
      </div>

      {siteRouters.length > 1 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {siteRouters.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setRouterId(r.id)}
              className={`min-h-12 rounded-xl px-4 font-semibold ring-1 ${r.id === routerId ? 'bg-brand-600 text-white ring-brand-600' : 'bg-white text-slate-700 ring-slate-300'}`}
            >
              {r.name}
            </button>
          ))}
        </div>
      )}

      <div className="space-y-3">
        {!siteId && <Alert tone="info">Choose a site to start selling.</Alert>}
        {siteId && routers.data && siteRouters.length === 0 && <Alert tone="warning">This site has no router yet. An admin must add one on the Routers page.</Alert>}
        {router?.status === 'offline' && (
          <Alert tone="warning">
            Router {router.name} is offline{router.last_seen_at ? ` since ${formatJubaTime(router.last_seen_at)}` : ''}. You can still sell, but customers cannot log in until it is back.
          </Alert>
        )}
        {sell.error && <Alert tone="error">{sell.error.message}</Alert>}
        {stock.error && <Alert tone="error">{friendlyError(stock.error)}</Alert>}
      </div>

      {router && (
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {plans.isLoading && <Spinner className="h-8 w-8 text-brand-600" />}
          {activePlans.map((plan) => (
            <PlanButton key={plan.id} plan={plan} stock={stock.data?.get(plan.id) ?? (stock.data ? 0 : undefined)} busy={sell.isPending} onSell={() => sell.mutate(plan)} />
          ))}
        </div>
      )}

      {sell.isPending && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-white/60">
          <Spinner className="h-14 w-14 text-brand-600" />
        </div>
      )}

      {canGenerate && router && (
        <p className="mt-6 text-sm text-slate-600">
          Running low? <Link to="/vouchers/generate" className="font-semibold text-brand-700 underline">Generate vouchers</Link>. Pre-printed cards are not sold here — record them with{' '}
          <Link to="/sales/mark-sold" className="font-semibold text-brand-700 underline">Mark as sold</Link>.
        </p>
      )}
    </div>
  );
}
