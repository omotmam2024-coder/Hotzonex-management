import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../auth/AuthProvider';
import { Alert, Button, Select, Spinner } from '../../components/ui';
import { friendlyError, isNetworkError } from '../../lib/errors';
import { LOW_STOCK } from '../../lib/labels';
import { rolesFor } from '../../lib/nav';
import { PageHeader } from '../../components/PageHeader';
import { codeGroups, formatDuration, formatJubaTime, formatSSP, formatUsd } from '../../lib/format';
import { useUsdRate } from '../../hooks/useBusinessSettings';
import { invalidateSalesData, usePlans, useRouters, useSites } from '../../hooks/queries';
import { readStored, writeStored } from '../../lib/storage';
import { supabase } from '../../lib/supabase';
import { planOnRouter, type Plan, type RouterInfo } from '../../lib/types';
import type { ReceiptData } from '../../print/Receipt';
import { loginAddress } from '../../print/voucherLinks';
import { hotspotAddress } from '../../lib/routers';
import { useT } from '../../i18n';
import { translate } from '../../i18n/translate';

const LAST_SALE_KEY = 'hzc.lastSale';
const SITE_KEY = 'hzc.sellSite';

interface LastSale {
  receipt: ReceiptData;
}

/** The text a customer receives when the code is shared (WhatsApp, SMS…). */
function shareText(r: ReceiptData): string {
  const login = loginAddress(r.dnsName);
  return [
    translate('sell.share.code', { code: r.code }),
    `${r.planName} · ${formatDuration(r.uptimeSeconds)} · ${formatSSP(r.priceSsp)}`,
    translate('sell.typeOnlyCode'),
    login ? (r.hotspotIp ? translate('sell.share.loginAtOr', { address: login, ip: loginAddress(r.hotspotIp) }) : translate('sell.share.loginAt', { address: login })) : '',
    r.siteName ? `— ${r.siteName}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/** The phone's share sheet when it has one; otherwise WhatsApp (works on every Android phone). */
async function shareCode(r: ReceiptData) {
  const text = shareText(r);
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ text });
      return;
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return; // closed by the cashier
    }
  }
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
}

function SaleResult({ sale, onPrint, onNext }: { sale: LastSale; onPrint: () => void; onNext: () => void }) {
  const { t } = useT();
  const r = sale.receipt;
  const usd = formatUsd(r.priceSsp, useUsdRate());
  return (
    <div className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-white" role="dialog" aria-label={t('sell.voucherSold')}>
      <div className="px-4 py-5 text-center text-white" style={{ backgroundColor: r.planColor }}>
        <div className="text-3xl font-extrabold tabular-nums sm:text-5xl">{formatSSP(r.priceSsp)}</div>
        {usd && <div className="text-lg font-semibold opacity-90">{usd}</div>}
        <div className="text-2xl font-bold sm:text-3xl">{formatDuration(r.uptimeSeconds)}</div>
      </div>
      <div className="flex flex-1 flex-col items-center justify-center px-4 py-6 text-center">
        <div className="text-lg font-semibold uppercase tracking-wide text-slate-500">{t('sell.wifiCode')}</div>
        <div className="mt-2 flex flex-wrap justify-center gap-x-[0.35em] font-extrabold leading-none tabular-nums text-slate-900" style={{ fontSize: 'clamp(56px, 17vw, 170px)' }} aria-label={r.code}>
          {codeGroups(r.code).map((g, i) => (
            <span key={i}>{g}</span>
          ))}
        </div>
        <p className="mt-6 text-lg text-slate-700">{t('sell.typeOnlyCode')}</p>
        <p className="text-xl font-bold text-slate-900">{loginAddress(r.dnsName)}</p>
        {r.hotspotIp && <p className="text-slate-600">{t('sell.orAddress', { address: loginAddress(r.hotspotIp) })}</p>}
      </div>
      <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3">
        <Button variant="secondary" onClick={onPrint} className="min-h-16 text-xl">
          {t('common.print')}
        </Button>
        <Button variant="secondary" onClick={() => void shareCode(r)} className="min-h-16 text-xl">
          {t('common.share')}
        </Button>
        <Button onClick={onNext} className="col-span-2 min-h-16 text-xl sm:col-span-1">
          {t('sell.sellAnother')}
        </Button>
      </div>
    </div>
  );
}

function PlanButton({ plan, stock, busy, canGenerate, onSell }: { plan: Plan; stock: number | undefined; busy: boolean; canGenerate: boolean; onSell: () => void }) {
  const { t } = useT();
  const count = stock ?? 0;
  const empty = stock !== undefined && count === 0;
  const low = !empty && count < LOW_STOCK;
  return (
    <button
      type="button"
      onClick={onSell}
      disabled={busy || empty || stock === undefined}
      className="relative flex min-h-36 w-full flex-col items-start justify-between rounded-2xl p-5 text-start text-white shadow-md transition active:scale-[0.98] disabled:cursor-not-allowed"
      style={{ backgroundColor: empty ? '#94a3b8' : plan.color }}
    >
      <div>
        <div className="text-4xl font-extrabold leading-tight tabular-nums">{formatSSP(plan.price_ssp)}</div>
        <div className="text-3xl font-bold">{formatDuration(plan.uptime_seconds)}</div>
        <div className="mt-1 text-base opacity-90">{plan.name}</div>
      </div>
      <div className="mt-3 w-full">
        {stock === undefined ? (
          <span className="text-base opacity-90">{t('sell.counting')}</span>
        ) : empty ? (
          <span className="block rounded-lg bg-white/90 px-3 py-2 text-base font-bold text-slate-800">{canGenerate ? t('sell.outGenerate') : t('sell.outTellManager')}</span>
        ) : low ? (
          <span className="inline-block rounded-lg bg-amber-300 px-3 py-1 text-lg font-bold text-amber-950">{t('sell.onlyLeft', { n: count })}</span>
        ) : (
          <span className="text-lg font-semibold">{t('sell.left', { n: count })}</span>
        )}
      </div>
    </button>
  );
}

/** A sale that failed; `network` when the reply never arrived (the sale may have happened). */
class SellError extends Error {
  readonly network: boolean;
  constructor(message: string, network: boolean) {
    super(message);
    this.network = network;
  }
}

/** A random UUID (crypto.randomUUID is missing on older Android browsers). */
function newRequestId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function SellPage() {
  const { t } = useT();
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
      return new Map((data ?? []).map((r) => [r.plan_id, Number(r.available)]));
    },
  });

  // A double tap must not sell two vouchers: the second tap comes before isPending re-renders.
  const inFlight = useRef(false);
  // One id per sale attempt, kept until it succeeds: when the reply is lost on a bad connection,
  // trying again (automatically, or by tapping again) returns the same card instead of a second one.
  const attempt = useRef<{ key: string; id: string } | null>(null);
  const sellPlan = (plan: Plan) => {
    if (inFlight.current) return;
    inFlight.current = true;
    const key = `${router?.id ?? ''}|${plan.id}`;
    if (attempt.current?.key !== key) attempt.current = { key, id: newRequestId() };
    sell.mutate(plan);
  };

  const sell = useMutation({
    mutationFn: async (plan: Plan): Promise<LastSale> => {
      if (!router) throw new Error(t('sell.chooseRouterFirst'));
      const { data, error } = await supabase.rpc('sell_voucher', { p_router_id: router.id, p_plan_id: plan.id, p_request_id: attempt.current?.id ?? null });
      if (error) throw new SellError(friendlyError(error), isNetworkError(error.message));
      const row = data?.[0];
      if (!row) throw new Error(t('sell.noCodeReturned'));
      return {
        receipt: {
          code: row.code,
          siteName,
          dnsName: router.dns_name ?? '',
          hotspotIp: hotspotAddress(router),
          planName: plan.name,
          planColor: plan.color,
          priceSsp: row.amount_ssp,
          uptimeSeconds: plan.uptime_seconds,
          soldAt: row.sold_at,
          sellerName: profile?.full_name ?? null,
        },
      };
    },
    // Lost connection: asked again (same request id, so never a second card).
    retry: (count, err) => count < 2 && err instanceof SellError && err.network,
    retryDelay: (count) => 1500 * (count + 1),
    onSuccess: (sale) => {
      attempt.current = null;
      setLastSale(sale);
      writeStored('session', LAST_SALE_KEY, sale);
    },
    onError: (err) => {
      // The server answered (e.g. out of stock): the next tap is a new sale attempt.
      if (!(err instanceof SellError && err.network)) attempt.current = null;
    },
    onSettled: () => {
      inFlight.current = false;
      invalidateSalesData(queryClient);
    },
  });

  function sellAnother() {
    setLastSale(null);
    writeStored('session', LAST_SALE_KEY, null);
    sell.reset();
  }

  function printReceipt() {
    if (lastSale) navigate('/print/receipt?print=1', { state: { receipt: lastSale.receipt } });
  }

  // Only plans ticked for this router (Plans page).
  const activePlans = (plans.data ?? []).filter((p) => p.is_active && (!routerId || planOnRouter(p, routerId)));
  const canGenerate = Boolean(profile && rolesFor('/vouchers').includes(profile.role));

  return (
    <div className="mx-auto max-w-5xl">
      {lastSale && <SaleResult sale={lastSale} onPrint={printReceipt} onNext={sellAnother} />}

      <PageHeader
        title={t('sell.title')}
        subtitle={t('sell.subtitle')}
        actions={
          !fixedSite && (
            <div className="w-full sm:w-64">
              <Select
                value={siteId}
                aria-label={t('common.site')}
                onChange={(e) => {
                  setSiteId(e.target.value);
                  writeStored('local', SITE_KEY, e.target.value);
                }}
              >
                <option value="">{t('sell.chooseSite')}</option>
                {(sites.data ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </div>
          )
        }
      />

      {siteRouters.length > 1 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {siteRouters.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setRouterId(r.id)}
              className={`min-h-11 rounded-xl px-4 font-semibold ring-1 ${r.id === routerId ? 'bg-brand-600 text-white ring-brand-600' : 'bg-white text-slate-700 ring-slate-300'}`}
            >
              {r.name}
            </button>
          ))}
        </div>
      )}

      <div className="space-y-3">
        {!siteId && <Alert tone="info">{t('sell.chooseSiteToStart')}</Alert>}
        {siteId && routers.data && siteRouters.length === 0 && <Alert tone="warning">{t('sell.noRouter')}</Alert>}
        {router?.status === 'offline' && (
          <Alert tone="warning">
            {router.last_seen_at
              ? t('sell.routerOfflineSince', { name: router.name, time: formatJubaTime(router.last_seen_at) })
              : t('sell.routerOffline', { name: router.name })}
          </Alert>
        )}
        {sell.error && <Alert tone="error">{sell.error.message}</Alert>}
        {stock.error && <Alert tone="error">{friendlyError(stock.error)}</Alert>}
      </div>

      {router && (
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {plans.isLoading && <Spinner className="h-8 w-8 text-brand-600" />}
          {activePlans.map((plan) => (
            <PlanButton key={plan.id} plan={plan} stock={stock.data?.get(plan.id) ?? (stock.data ? 0 : undefined)} busy={sell.isPending} canGenerate={canGenerate} onSell={() => sellPlan(plan)} />
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
          {t('sell.runningLow')}{' '}
          <Link to="/vouchers/generate" className="font-semibold text-brand-700 underline">
            {t('sell.generateVouchers')}
          </Link>
          . {t('sell.preprintedNote')}{' '}
          <Link to="/sales/mark-sold" className="font-semibold text-brand-700 underline">
            {t('sell.markSoldLink')}
          </Link>
          .
        </p>
      )}
    </div>
  );
}
