import { useEffect, useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { friendlyError } from '../lib/errors';
import { formatDuration, formatNumber } from '../lib/format';
import { invokeFunction } from '../lib/functions';

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
  if (p.data_limit_mb) parts.push(p.data_limit_mb >= 1024 ? `${Math.round(p.data_limit_mb / 102.4) / 10} GB` : `${p.data_limit_mb} MB`);
  if (p.validity_seconds) parts.push(`use within ${formatDuration(p.validity_seconds)}`);
  return parts.join(' · ');
}

/** Public page: a customer buys a WiFi card with mobile money; a cashier confirms it. */
export function BuyPage() {
  const { slug = '' } = useParams();
  const [claim, setClaim] = useState<Claim | null>(() => readClaim(slug));
  const [planId, setPlanId] = useState('');
  const [provider, setProvider] = useState('mtn_momo');
  const [phone, setPhone] = useState('');
  const [txn, setTxn] = useState('');

  const site = useQuery({
    queryKey: ['buy-site', slug],
    queryFn: () => invokeFunction<BuySite>('buy', { action: 'site', slug }),
    retry: false,
  });

  const status = useQuery({
    queryKey: ['buy-status', claim?.id],
    enabled: Boolean(claim),
    queryFn: () => invokeFunction<BuyStatus>('buy', { action: 'status', id: claim!.id, token: claim!.token }),
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
    mutationFn: () => invokeFunction<Claim>('buy', { action: 'request', slug, plan_id: planId, phone, provider, txn_ref: txn }),
    onSuccess: (c) => {
      saveClaim(slug, c);
      setClaim(c);
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    send.mutate();
  }

  function startOver() {
    saveClaim(slug, null);
    setClaim(null);
    setTxn('');
    send.reset();
  }

  const s = site.data;
  const plan = s?.plans.find((p) => p.id === planId);
  const st = status.data;

  return (
    <div className="min-h-full bg-gradient-to-br from-brand-700 via-brand-900 to-brand-950 p-4">
      <div className="mx-auto w-full max-w-md space-y-4">
        <header className="flex items-center gap-3 pt-2 text-white">
          {s?.logo_url ? <img src={s.logo_url} alt="" className="h-12 w-12 rounded-xl bg-white object-contain p-1" /> : null}
          <div>
            <h1 className="text-xl font-bold">{s ? s.business : 'Buy WiFi'}</h1>
            {s && <p className="text-white/70">{s.site} · Buy a WiFi card</p>}
          </div>
        </header>

        <div className="rounded-2xl bg-white p-5 shadow-xl">
          {site.isLoading && <p className="text-slate-600">Loading…</p>}
          {site.error && <p className="font-medium text-red-700">{friendlyError(site.error)}</p>}

          {s && claim && (
            <div className="space-y-4 text-center">
              {(!st || st.status === 'pending') && (
                <>
                  <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-brand-100 border-t-brand-600" />
                  <h2 className="text-lg font-bold">Waiting for the cashier</h2>
                  <p className="text-slate-600">
                    They are checking that your payment arrived. Keep this page open — your card appears here. It usually takes a few minutes.
                  </p>
                </>
              )}
              {st?.status === 'confirmed' && (
                <>
                  <h2 className="text-lg font-bold text-green-700">Paid ✓ — your {st.plan} card</h2>
                  <p className="select-all rounded-2xl bg-slate-100 py-4 font-mono text-4xl font-bold tracking-widest text-slate-900">{st.code}</p>
                  {st.ready ? (
                    <p className="text-slate-700">
                      Type this code on the WiFi login page{st.login_host ? ` (${st.login_host})` : ''}. Write it down or take a screenshot.
                    </p>
                  ) : (
                    <p className="text-amber-800">Your card is being added to the WiFi now. It works in about a minute.</p>
                  )}
                  {st.ready && st.login_host && (
                    <a href={`http://${st.login_host}/login`} className="inline-flex min-h-12 items-center justify-center rounded-xl bg-brand-600 px-5 text-lg font-semibold text-white">
                      Go to the WiFi login
                    </a>
                  )}
                  <button type="button" onClick={startOver} className="block w-full text-sm font-semibold text-brand-700 underline">
                    Buy another card
                  </button>
                </>
              )}
              {(st?.status === 'rejected' || st?.status === 'expired') && (
                <>
                  <h2 className="text-lg font-bold text-red-700">{st.status === 'rejected' ? 'Payment not confirmed' : 'Payment not confirmed in time'}</h2>
                  <p className="text-slate-700">
                    {st.reason ?? 'Please ask the cashier.'} If you did pay, show the cashier your payment message.
                  </p>
                  <button type="button" onClick={startOver} className="min-h-12 w-full rounded-xl bg-brand-600 px-4 font-semibold text-white">
                    Try again
                  </button>
                </>
              )}
            </div>
          )}

          {s && !claim && (
            <form onSubmit={submit} className="space-y-4" noValidate>
              <div>
                <h2 className="mb-2 font-bold text-slate-900">1. Choose your card</h2>
                {s.plans.length === 0 && <p className="text-slate-600">No cards for sale right now. Please ask the cashier.</p>}
                <div className="grid gap-2">
                  {s.plans.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setPlanId(p.id)}
                      className={`flex min-h-14 items-center justify-between rounded-xl border-2 px-4 text-left ${planId === p.id ? 'border-brand-600 bg-brand-50' : 'border-slate-200'}`}
                    >
                      <span>
                        <span className="block font-semibold text-slate-900">{p.name}</span>
                        <span className="block text-xs text-slate-500">{planLine(p)}</span>
                      </span>
                      <span className="font-bold text-slate-900">{formatNumber(p.price_ssp)} SSP</span>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <h2 className="mb-2 font-bold text-slate-900">2. Send the money</h2>
                <p className="whitespace-pre-line rounded-xl bg-amber-50 p-3 text-sm text-amber-950">
                  {s.instructions}
                  {plan && (
                    <>
                      {'\n'}
                      <b>Amount: {formatNumber(plan.price_ssp)} SSP</b>
                    </>
                  )}
                </p>
              </div>

              <div className="space-y-3">
                <h2 className="font-bold text-slate-900">3. Tell us your payment</h2>
                <label className="block">
                  <span className="mb-1 block text-sm font-medium text-slate-700">Paid with</span>
                  <select value={provider} onChange={(e) => setProvider(e.target.value)} className={input}>
                    {s.providers.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-sm font-medium text-slate-700">Your phone number</span>
                  <input type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className={input} placeholder="092…" />
                </label>
                <label className="block">
                  <span className="mb-1 block text-sm font-medium text-slate-700">Transaction ID</span>
                  <input
                    value={txn}
                    onChange={(e) => setTxn(e.target.value)}
                    autoCapitalize="characters"
                    autoComplete="off"
                    spellCheck={false}
                    className={input}
                    placeholder="From your payment SMS"
                  />
                </label>
              </div>

              {send.error && (
                <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm font-medium text-red-800">
                  {friendlyError(send.error)}
                </p>
              )}
              <button
                type="submit"
                disabled={send.isPending || !planId || !phone.trim() || !txn.trim()}
                className="min-h-12 w-full rounded-xl bg-brand-600 px-4 text-lg font-semibold text-white disabled:opacity-50"
              >
                {send.isPending ? 'Sending…' : 'I have paid — get my card'}
              </button>
              <p className="text-center text-xs text-slate-500">A cashier checks every payment before the card is given.</p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
