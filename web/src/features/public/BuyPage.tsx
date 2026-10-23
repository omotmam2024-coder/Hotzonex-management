import { useEffect, useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { friendlyError } from '../../lib/errors';
import { formatDuration, formatSSP } from '../../lib/format';
import { formatDataLimit } from '../../lib/dataLimit';
import { Alert } from '../../components/ui';
import { callPublicFunction } from '../../lib/functions';
import { buyMomoSchema, buyRequestSchema, validate } from '../../lib/validation';
import { LanguageSwitch } from '../../components/LanguageSwitch';
import { translate, translateMessage, useT } from '../../i18n';

interface BuyPlan {
  id: string;
  name: string;
  price_ssp: number;
  uptime_seconds: number | null;
  validity_seconds: number | null;
  data_limit_mb: number | null;
  color: string;
}

interface BuySite {
  site: string;
  business: string;
  logo_url: string | null;
  instructions: string;
  plans: BuyPlan[];
  providers: { id: string; label: string }[];
  /** The business takes MTN MoMo payments through the MoMo API (a prompt on the customer's phone). */
  momo_api?: boolean;
}

interface Claim {
  id: string;
  token: string;
}

interface BuyStatus {
  status: 'pending' | 'confirmed' | 'rejected' | 'expired';
  plan: string;
  amount: number;
  reason?: string | null;
  method?: 'manual' | 'api';
  code?: string | null;
  ready?: boolean;
  login_host?: string | null;
}

const input =
  'min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100';

function storageKey(slug: string) {
  return `hzc.buy.${slug}`;
}

function readClaim(slug: string): Claim | null {
  try {
    const raw = window.localStorage.getItem(storageKey(slug));
    const c = raw ? (JSON.parse(raw) as Claim) : null;
    return c?.id && c.token ? c : null;
  } catch {
    return null;
  }
}

function saveClaim(slug: string, claim: Claim | null) {
  try {
    if (claim) window.localStorage.setItem(storageKey(slug), JSON.stringify(claim));
    else window.localStorage.removeItem(storageKey(slug));
  } catch {
    // Private mode: the page still works while it stays open.
  }
}

function planLine(p: BuyPlan): string {
  const parts: string[] = [];
  if (p.uptime_seconds) parts.push(formatDuration(p.uptime_seconds));
  if (p.data_limit_mb) parts.push(formatDataLimit(p.data_limit_mb));
  if (p.validity_seconds) parts.push(translate('public.buy.useWithin', { time: formatDuration(p.validity_seconds) }));
  return parts.join(' · ');
}

/**
 * Public page: a customer buys a WiFi card with mobile money. With the business's MTN MoMo API on,
 * MoMo asks the customer's phone to approve and the card comes as soon as MoMo confirms; otherwise
 * (or "Paid another way?") the customer types the transaction ID and a cashier confirms it.
 */
export function BuyPage() {
  const { slug = '' } = useParams();
  const { t } = useT();
  const [claim, setClaim] = useState<Claim | null>(() => readClaim(slug));
  const [planId, setPlanId] = useState('');
  const [provider, setProvider] = useState('mtn_momo');
  const [phone, setPhone] = useState('');
  const [txn, setTxn] = useState('');
  const [manual, setManual] = useState(false);

  const site = useQuery({
    queryKey: ['buy-site', slug],
    queryFn: () => callPublicFunction<BuySite>('buy', { action: 'site', slug }),
    retry: false,
    // Always asked (a phone that thinks it is offline must not wait for ever without a message).
    networkMode: 'always',
  });

  const status = useQuery({
    queryKey: ['buy-status', claim?.id],
    enabled: Boolean(claim),
    queryFn: () => callPublicFunction<BuyStatus>('buy', { action: 'status', id: claim!.id, token: claim!.token }),
    networkMode: 'always',
    refetchInterval: (q) => {
      const s = q.state.data;
      return !s || s.status === 'pending' || (s.status === 'confirmed' && !s.ready) ? 5000 : false;
    },
    retry: false,
  });

  useEffect(() => {
    // A request this browser no longer may see (e.g. expired token): start again.
    if (status.error) {
      saveClaim(slug, null);
      setClaim(null);
    }
  }, [status.error, slug]);

  const send = useMutation({
    mutationFn: () => {
      const v = validate(buyRequestSchema, { plan_id: planId, phone, txn_ref: txn });
      return callPublicFunction<Claim>('buy', { action: 'request', slug, provider, ...v });
    },
    networkMode: 'always',
    onSuccess: (c) => {
      saveClaim(slug, c);
      setClaim(c);
    },
  });

  const payMomo = useMutation({
    mutationFn: () => {
      const v = validate(buyMomoSchema, { plan_id: planId, phone });
      return callPublicFunction<Claim>('buy', { action: 'momo_pay', slug, ...v }, 45_000);
    },
    networkMode: 'always',
    onSuccess: (c) => {
      saveClaim(slug, c);
      setClaim(c);
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (momo) payMomo.mutate();
    else send.mutate();
  }

  function startOver() {
    saveClaim(slug, null);
    setClaim(null);
    setTxn('');
    send.reset();
    payMomo.reset();
  }

  const s = site.data;
  const plan = s?.plans.find((p) => p.id === planId);
  const st = status.data;
  const momo = Boolean(s?.momo_api) && !manual;
  const busy = send.isPending || payMomo.isPending;
  const error = send.error ?? payMomo.error;

  return (
    <div className="min-h-full bg-gradient-to-br from-brand-700 via-brand-900 to-brand-950 p-4">
      <div className="mx-auto w-full max-w-md space-y-4">
        <div className="ms-auto max-w-xs">
          <LanguageSwitch tone="light" />
        </div>
        <header className="flex items-center gap-3 pt-2 text-white">
          {s?.logo_url ? <img src={s.logo_url} alt="" className="h-12 w-12 rounded-xl bg-white object-contain p-1" /> : null}
          <div>
            <h1 className="text-xl font-bold">{s ? s.business : t('public.buy.title')}</h1>
            {s && <p className="text-white/70">{s.site} · {t('public.buy.subtitle')}</p>}
          </div>
        </header>

        <div className="rounded-2xl bg-white p-5 shadow-xl">
          {site.isLoading && <p className="text-slate-600">{t('public.buy.loading')}</p>}
          {site.error && (
            <div className="space-y-3">
              <p className="font-medium text-red-700">{friendlyError(site.error)}</p>
              <button
                type="button"
                onClick={() => void site.refetch()}
                disabled={site.isFetching}
                className="min-h-12 w-full rounded-xl bg-brand-600 px-4 font-semibold text-white disabled:opacity-50"
              >
                {site.isFetching ? t('public.buy.trying') : t('public.buy.tryAgain')}
              </button>
            </div>
          )}

          {s && claim && (
            <div className="space-y-4 text-center">
              {(!st || st.status === 'pending') && (
                <>
                  <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-brand-100 border-t-brand-600" />
                  {st?.method === 'api' ? (
                    <>
                      <h2 className="text-lg font-bold">{t('public.buy.approveTitle')}</h2>
                      <p className="text-slate-600">{t('public.buy.approveText')}</p>
                      <p className="text-sm text-slate-500">{t('public.buy.approveHint')}</p>
                    </>
                  ) : (
                    <>
                      <h2 className="text-lg font-bold">{t('public.buy.waitingTitle')}</h2>
                      <p className="text-slate-600">{t('public.buy.waitingText')}</p>
                    </>
                  )}
                </>
              )}
              {st?.status === 'confirmed' && (
                <>
                  <h2 className="text-lg font-bold text-green-700">{t('public.buy.paidTitle', { plan: st.plan })}</h2>
                  <p dir="ltr" className="select-all rounded-2xl bg-slate-100 py-4 font-mono text-4xl font-bold tracking-widest text-slate-900">{st.code}</p>
                  {st.ready ? (
                    <p className="text-slate-700">{t('public.buy.typeCode', { host: st.login_host ? ` (${st.login_host})` : '' })}</p>
                  ) : (
                    <p className="text-amber-800">{t('public.buy.beingAdded')}</p>
                  )}
                  {st.ready && st.login_host && (
                    <a href={`http://${st.login_host}/login`} className="inline-flex min-h-12 items-center justify-center rounded-xl bg-brand-600 px-5 text-lg font-semibold text-white">
                      {t('public.buy.goLogin')}
                    </a>
                  )}
                  <button type="button" onClick={startOver} className="block w-full text-sm font-semibold text-brand-700 underline">
                    {t('public.buy.another')}
                  </button>
                </>
              )}
              {(st?.status === 'rejected' || st?.status === 'expired') && (
                <>
                  <h2 className="text-lg font-bold text-red-700">{st.status === 'rejected' ? t('public.buy.rejected') : t('public.buy.expired')}</h2>
                  <p className="text-slate-700">
                    {st.reason ? translateMessage(st.reason) : t('public.buy.askCashier')} {st.method === 'api' ? '' : t('public.buy.ifPaid')}
                  </p>
                  <button type="button" onClick={startOver} className="min-h-12 w-full rounded-xl bg-brand-600 px-4 font-semibold text-white">
                    {t('public.buy.tryAgain')}
                  </button>
                </>
              )}
            </div>
          )}

          {s && !claim && (
            <form onSubmit={submit} className="space-y-4" noValidate>
              <div>
                <h2 className="mb-2 font-bold text-slate-900">{t('public.buy.step1')}</h2>
                {s.plans.length === 0 && <p className="text-slate-600">{t('public.buy.noCards')}</p>}
                <div className="grid gap-2">
                  {s.plans.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setPlanId(p.id)}
                      className={`flex min-h-14 items-center justify-between rounded-xl border-2 px-4 text-start ${planId === p.id ? 'border-brand-600 bg-brand-50' : 'border-slate-200'}`}
                    >
                      <span>
                        <span className="block font-semibold text-slate-900">{p.name}</span>
                        <span className="block text-xs text-slate-500">{planLine(p)}</span>
                      </span>
                      <span className="font-bold text-slate-900">{formatSSP(p.price_ssp)}</span>
                    </button>
                  ))}
                </div>
              </div>

              {momo ? (
                <div className="space-y-3">
                  <h2 className="font-bold text-slate-900">{t('public.buy.momoTitle')}</h2>
                  {plan && <p className="font-semibold text-slate-900">{t('public.buy.amount', { amount: formatSSP(plan.price_ssp) })}</p>}
                  <label className="block">
                    <span className="mb-1 block text-sm font-medium text-slate-700">{t('public.buy.momoPhone')}</span>
                    <input type="tel" dir="ltr" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className={input} placeholder="092…" />
                  </label>
                  <p className="text-sm text-slate-600">{t('public.buy.momoNote')}</p>
                </div>
              ) : (
                <>
                <div>
                  <h2 className="mb-2 font-bold text-slate-900">{t('public.buy.step2')}</h2>
                  <Alert tone="warning">
                    <p className="whitespace-pre-line">
                      {s.instructions}
                      {plan && (
                        <>
                          {'\n'}
                          <b>{t('public.buy.amount', { amount: formatSSP(plan.price_ssp) })}</b>
                        </>
                      )}
                    </p>
                  </Alert>
                </div>
  
                <div className="space-y-3">
                  <h2 className="font-bold text-slate-900">{t('public.buy.step3')}</h2>
                  <label className="block">
                    <span className="mb-1 block text-sm font-medium text-slate-700">{t('public.buy.paidWith')}</span>
                    <select value={provider} onChange={(e) => setProvider(e.target.value)} className={input}>
                      {s.providers.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.id === 'other' ? t('public.buy.providerOther') : p.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-sm font-medium text-slate-700">{t('public.buy.phone')}</span>
                    <input type="tel" dir="ltr" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className={input} placeholder="092…" />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-sm font-medium text-slate-700">{t('public.buy.txn')}</span>
                    <input
                      value={txn}
                      onChange={(e) => setTxn(e.target.value)}
                      dir="ltr"
                      autoCapitalize="characters"
                      autoComplete="off"
                      spellCheck={false}
                      className={input}
                      placeholder={t('public.buy.txnPlaceholder')}
                    />
                  </label>
                </div>
  
                </>
              )}

              {error && (
                <Alert tone="error">
                  {friendlyError(error)}
                </Alert>
              )}
              <button
                type="submit"
                disabled={busy || !planId || !phone.trim() || (!momo && !txn.trim())}
                className="min-h-12 w-full rounded-xl bg-brand-600 px-4 text-lg font-semibold text-white disabled:opacity-50"
              >
                {momo
                  ? payMomo.isPending
                    ? t('public.buy.sendingMomo')
                    : t('public.buy.momoPay')
                  : send.isPending
                    ? t('public.buy.sending')
                    : t('public.buy.submit')}
              </button>
              {!momo && <p className="text-center text-xs text-slate-500">{t('public.buy.note')}</p>}
              {s.momo_api && (
                <button
                  type="button"
                  onClick={() => {
                    setManual(!manual);
                    send.reset();
                    payMomo.reset();
                  }}
                  className="block w-full text-center text-sm font-semibold text-brand-700 underline"
                >
                  {manual ? t('public.buy.useMomo') : t('public.buy.otherWay')}
                </button>
              )}
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
