import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import qrcode from 'qrcode-generator';
import { useAuth } from '../../auth/AuthProvider';
import { MomoSettings } from '../../components/MomoSettings';
import { Step } from '../../components/Step';
import { PageHeader } from '../../components/PageHeader';
import { Alert, Badge, Button, Card, Checkbox, Field, Spinner, TextArea, TextInput, textButtonClass } from '../../components/ui';
import { friendlyError } from '../../lib/errors';
import { formatJubaTime, formatSSP } from '../../lib/format';
import { PAYMENT_STATUS } from '../../lib/labels';
import { invalidateSalesData, usePlans, useSites } from '../../hooks/queries';
import { fromJson, supabase, supabaseUrl } from '../../lib/supabase';
import type { SiteRow } from '../../lib/types';
import { readStored, writeStored } from '../../lib/storage';
import { useT } from '../../i18n';
import { translate } from '../../i18n/translate';

interface PaymentRow {
  id: string;
  site_id: string;
  plan_id: string;
  amount_ssp: number;
  phone: string;
  provider: string;
  txn_ref: string;
  status: 'pending' | 'confirmed' | 'rejected' | 'expired';
  reject_reason: string | null;
  created_at: string;
  decided_at: string | null;
  /** 'api': MTN MoMo API payment, confirmed by MoMo itself; 'manual': the cashier checks it. */
  method: string;
  momo_txn_id: string | null;
}

interface ConfirmResult {
  code: string;
  on_router: boolean;
}

const PROVIDER: Record<string, string> = {
  mtn_momo: 'MTN MoMo',
  mgurush: 'm-Gurush',
  digicash: 'Digicash',
  get other() {
    return translate('sales.pay.other');
  },
};

function buyUrl(slug: string) {
  return `${window.location.origin}/buy/${slug}`;
}

function qrSvg(text: string, cell = 6): string {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  // A white border of 4 squares (the QR standard): every scanner app reads it.
  return qr.createSvgTag({ cellSize: cell, margin: 4, scalable: true });
}

function slugFrom(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .padEnd(3, '0');
}

/** The QR text phones read as "join this WiFi" (an open hotspot network, no password). */
function wifiQrText(ssid: string): string {
  return `WIFI:T:nopass;S:${ssid.replace(/([\\;,:"])/g, '\\$1')};;`;
}

/**
 * A printable A4 poster: the QR code and link to the Buy page and, when the WiFi name is given, a
 * second code that joins the phone to the WiFi (the only kind the scanner in WiFi settings reads).
 */
function printPoster(site: SiteRow, business: string, wifiName: string, dir: 'ltr' | 'rtl') {
  const url = buyUrl(site.buy_slug ?? '');
  const esc = (t: string) => t.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const w = window.open('', '_blank');
  if (!w) return;
  const ssid = wifiName.trim();
  const tr = (key: Parameters<typeof translate>[0], vars?: Parameters<typeof translate>[1]) => esc(translate(key, vars));
  const codes = ssid
    ? `<div class="row"><div class="box"><h2>${tr('sales.poster.join')}</h2><div class="qr">${qrSvg(wifiQrText(ssid), 10)}</div>
<p>${tr('sales.poster.scanSettings')}</p><p class="url">${esc(ssid)}</p></div>
<div class="box"><h2>${tr('sales.poster.buyCard')}</h2><div class="qr">${qrSvg(url, 10)}</div><p>${tr('sales.poster.scanCamera')}</p></div></div>`
    : `<div class="qr big">${qrSvg(url, 10)}</div><p>${tr('sales.poster.scanCameraOrLink')}</p>`;
  w.document.write(`<!doctype html><html dir="${dir}"><head><meta charset="utf-8"><title>${tr('sales.poster.docTitle', { site: site.name })}</title>
<style>body{font-family:system-ui,sans-serif;text-align:center;margin:32px}h1{font-size:44px;margin:0 0 8px}h2{font-size:28px;margin:0}p{font-size:20px;margin:6px 0}
.row{display:flex;gap:24px;justify-content:center;margin:24px 0}.box{flex:1;max-width:340px}.qr{width:300px;margin:12px auto}.qr.big{width:420px;margin:24px auto}
.qr svg{width:100%;height:auto}.url{font-size:20px;font-weight:700;word-break:break-all}.steps{font-size:22px}</style></head>
<body><h1>${tr('sales.poster.heading')}</h1><p>${esc(business)} · ${esc(site.name)}</p>${codes}
<p class="steps">${tr('sales.poster.steps')}</p><p class="url" dir="ltr">${esc(url)}</p>
</body></html>`);
  w.document.close();
  // Printed from here: the poster window may not run scripts of its own (Content-Security-Policy).
  w.setTimeout(() => w.print(), 300);
}

function BuySettings({ site }: { site: SiteRow }) {
  const { t, dir } = useT();
  const { business } = useAuth();
  const queryClient = useQueryClient();
  const [enabled, setEnabled] = useState(site.buy_enabled);
  const wifiKey = `hzc.posterWifi.${site.id}`;
  const [wifiName, setWifiNameState] = useState(() => readStored<string>('local', wifiKey) ?? '');
  const setWifiName = (v: string) => {
    setWifiNameState(v);
    writeStored('local', wifiKey, v || null);
  };
  const [slug, setSlug] = useState(site.buy_slug ?? slugFrom(`${business?.name ?? ''} ${site.name}`));
  const [instructions, setInstructions] = useState(site.buy_instructions ?? '');
  useEffect(() => {
    setEnabled(site.buy_enabled);
    if (site.buy_slug) setSlug(site.buy_slug);
    if (site.buy_instructions) setInstructions(site.buy_instructions);
  }, [site]);

  const save = useMutation({
    mutationFn: async () => {
      const hosts = [window.location.hostname, new URL(supabaseUrl).hostname].filter((h) => h.includes('.') && h !== 'localhost');
      const { error } = await supabase.rpc('save_buy_settings', {
        p_site_id: site.id,
        p_enabled: enabled,
        p_slug: slug,
        p_instructions: instructions,
        p_hosts: hosts,
      });
      if (error) throw new Error(friendlyError(error));
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['sites'] }),
  });

  const live = site.buy_enabled && site.buy_slug;
  const svg = useMemo(() => (live ? qrSvg(buyUrl(site.buy_slug!)) : ''), [live, site.buy_slug]);
  const missingNumber = enabled && !instructions.trim();

  return (
    <div className="space-y-4 rounded-2xl border border-slate-200 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-lg font-bold">{site.name}</h3>
        {live ? <Badge color="green">{t('sales.buy.open')}</Badge> : <Badge color="gray">{t('sales.buy.closed')}</Badge>}
      </div>

      <Step n={1} title={t('sales.mm.step1')}>
        <Checkbox label={t('sales.buy.enable')} checked={enabled} onChange={setEnabled} />
      </Step>

      {enabled && (
        <Step n={2} title={t('sales.mm.step2')}>
          <TextArea
            value={instructions}
            onChange={(e) => setInstructions(e.target.value.slice(0, 500))}
            rows={2}
            placeholder={t('sales.mm.numberExample')}
            aria-label={t('sales.mm.step2')}
          />
          <p className="text-xs text-slate-500">{t('sales.mm.numberHint')}</p>
          <details className="text-sm">
            <summary className="cursor-pointer py-1 font-medium text-brand-700">{t('sales.mm.changeAddress')}</summary>
            <Field label={t('sales.buy.address')} hint={`${window.location.origin}/buy/${slug || '…'}`}>
              <TextInput dir="ltr" value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40))} />
            </Field>
          </details>
        </Step>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => save.mutate()} disabled={save.isPending || missingNumber} className="min-h-12">
          {save.isPending && <Spinner />} {t('common.save')}
        </Button>
        {missingNumber && <span className="text-sm text-amber-800">{t('sales.mm.needNumber')}</span>}
      </div>
      {save.isSuccess && <Alert tone="success">{enabled ? t('sales.mm.savedOpen') : t('sales.buy.savedClosed')}</Alert>}
      {save.error && <Alert tone="error">{friendlyError(save.error)}</Alert>}

      {live && (
        <Step n={3} title={t('sales.mm.step3')}>
          <div className="flex flex-wrap items-start gap-4">
            <div className="h-32 w-32 shrink-0 rounded-lg bg-white p-1 ring-1 ring-slate-200" dangerouslySetInnerHTML={{ __html: svg }} />
            <div className="min-w-0 flex-1 space-y-2">
              <a href={buyUrl(site.buy_slug!)} target="_blank" rel="noopener" dir="ltr" className="block break-all text-sm font-semibold text-brand-700 underline">
                {buyUrl(site.buy_slug!)}
              </a>
              <Field label={t('sales.buy.wifiName')} hint={t('sales.buy.wifiNameHint')}>
                <TextInput value={wifiName} onChange={(e) => setWifiName(e.target.value.slice(0, 32))} placeholder={t('sales.buy.wifiNamePlaceholder')} />
              </Field>
              <Button variant="secondary" onClick={() => printPoster(site, business?.name ?? '', wifiName, dir)}>
                {t('sales.buy.printPoster')}
              </Button>
            </div>
          </div>
        </Step>
      )}
    </div>
  );
}

function timeAgoShort(iso: string): string {
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (min < 1) return translate('common.justNow');
  if (min < 60) return translate('common.minAgo', { n: min });
  return formatJubaTime(iso);
}

const REJECT_REASONS = ['sales.mm.reason.notReceived', 'sales.mm.reason.wrongAmount', 'sales.mm.reason.wrongId'] as const;

/** A payment to check: the amount, who sent it and the transaction ID, then one big decision. */
function WaitingPayment({ p, siteName, planName, onConfirmed }: { p: PaymentRow; siteName: string; planName: string; onConfirmed: (result: ConfirmResult) => void }) {
  const { t } = useT();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<'look' | 'confirm' | 'reject'>('look');
  const api = p.method === 'api';
  // A double tap must not confirm twice: the second tap comes before isPending re-renders.
  const inFlight = useRef(false);
  const confirm = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('confirm_payment_request', { p_id: p.id });
      if (error) throw new Error(friendlyError(error));
      return fromJson<ConfirmResult>(data);
    },
    onSuccess: (result) => {
      onConfirmed(result);
      void queryClient.invalidateQueries({ queryKey: ['payments'] });
      invalidateSalesData(queryClient);
    },
    onSettled: () => {
      inFlight.current = false;
    },
  });
  const reject = useMutation({
    mutationFn: async (reason: string) => {
      const { error } = await supabase.rpc('reject_payment_request', { p_id: p.id, p_reason: reason });
      if (error) throw new Error(friendlyError(error));
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['payments'] }),
  });
  const busy = confirm.isPending || reject.isPending;

  return (
    <li className="rounded-2xl bg-white p-4 shadow-card ring-1 ring-slate-200">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-3xl font-extrabold tabular-nums text-slate-900">{formatSSP(p.amount_ssp)}</div>
          <div className="text-sm text-slate-600">
            {planName} · {siteName} · {timeAgoShort(p.created_at)}
          </div>
        </div>
        <span className="flex gap-1">
          <Badge color="blue">{PROVIDER[p.provider] ?? p.provider}</Badge>
          {api && <Badge color="green">{t('sales.mm.apiBadge')}</Badge>}
        </span>
      </div>
      <dl className="mt-3 grid gap-2 sm:grid-cols-2">
        <div className="rounded-xl bg-slate-50 p-3">
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t('sales.mm.from')}</dt>
          <dd dir="ltr" className="text-lg font-bold text-slate-900">
            {p.phone}
          </dd>
        </div>
        <div className="rounded-xl bg-slate-50 p-3">
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t('sales.mm.txn')}</dt>
          <dd dir="ltr" className="break-all font-mono text-lg font-bold text-slate-900">
            {p.momo_txn_id ?? p.txn_ref}
          </dd>
        </div>
      </dl>

      {/* MoMo API payments confirm themselves; the cashier steps in only when MoMo says paid but no card was given. */}
      {api && !p.momo_txn_id && <p className="mt-3 text-sm text-slate-700">{t('sales.mm.apiWaiting')}</p>}
      {api && p.momo_txn_id && (
        <div className="mt-3">
          <Alert tone="warning">{t('sales.mm.apiPaid', { id: p.momo_txn_id })}</Alert>
        </div>
      )}

      {step === 'look' && (!api || p.momo_txn_id) && (
        <>
          <p className="mt-3 text-sm text-slate-700">{t('sales.mm.check')}</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <Button onClick={() => setStep('confirm')} disabled={busy} className="min-h-12 !bg-green-600 hover:!bg-green-700">
              ✓ {t('sales.mm.arrived')}
            </Button>
            <Button variant="danger" onClick={() => setStep('reject')} disabled={busy} className="min-h-12">
              ✗ {t('sales.mm.notArrived')}
            </Button>
          </div>
        </>
      )}

      {step === 'confirm' && (
        <div className="mt-3 space-y-2 rounded-xl bg-green-50 p-3 ring-1 ring-green-200">
          <p className="font-semibold text-green-900">{t('sales.mm.sure', { amount: formatSSP(p.amount_ssp), ref: p.txn_ref })}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => {
                if (inFlight.current) return;
                inFlight.current = true;
                confirm.mutate();
              }}
              disabled={busy}
              className="min-h-12 !bg-green-600 hover:!bg-green-700"
            >
              {confirm.isPending && <Spinner />} {t('sales.mm.giveCard')}
            </Button>
            <Button variant="secondary" onClick={() => setStep('look')} disabled={busy}>
              {t('sales.mm.back')}
            </Button>
          </div>
        </div>
      )}

      {step === 'reject' && (
        <div className="mt-3 space-y-2 rounded-xl bg-red-50 p-3 ring-1 ring-red-200">
          <p className="font-semibold text-red-900">{t('sales.mm.why')}</p>
          <div className="grid gap-2 sm:grid-cols-3">
            {REJECT_REASONS.map((key) => (
              <Button key={key} variant="danger" onClick={() => reject.mutate(t(key))} disabled={busy}>
                {t(key)}
              </Button>
            ))}
          </div>
          <Button variant="secondary" onClick={() => setStep('look')} disabled={busy}>
            {t('sales.mm.back')}
          </Button>
        </div>
      )}
      {(confirm.error ?? reject.error) && (
        <div className="mt-2">
          <Alert tone="error">{friendlyError(confirm.error ?? reject.error)}</Alert>
        </div>
      )}
    </li>
  );
}

export function PaymentsPage() {
  const { t } = useT();
  const { profile } = useAuth();
  const sites = useSites();
  const plans = usePlans();
  // The last card given, kept here: the confirmed payment leaves the list.
  const [confirmed, setConfirmed] = useState<ConfirmResult | null>(null);
  const payments = useQuery({
    queryKey: ['payments'],
    refetchInterval: 10_000,
    queryFn: async (): Promise<PaymentRow[]> => {
      const { data, error } = await supabase
        .from('payment_requests')
        .select('id, site_id, plan_id, amount_ssp, phone, provider, txn_ref, status, reject_reason, created_at, decided_at, method, momo_txn_id')
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw new Error(friendlyError(error));
      return (data ?? []) as PaymentRow[];
    },
  });

  const siteName = (id: string) => sites.data?.find((s) => s.id === id)?.name ?? '';
  const planName = (id: string) => plans.data?.find((p) => p.id === id)?.name ?? t('sales.pay.card');
  const pending = (payments.data ?? []).filter((p) => p.status === 'pending');
  const done = (payments.data ?? []).filter((p) => p.status !== 'pending').slice(0, 30);
  const anyOpen = (sites.data ?? []).some((s) => s.buy_enabled && s.buy_slug);
  const isOwner = profile?.role === 'admin';

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader title={t('nav.payments')} subtitle={t('sales.mm.subtitle')} />

      {confirmed && (
        <div className="rounded-2xl bg-green-50 p-5 text-center ring-1 ring-green-200">
          <p className="font-semibold text-green-800">{t('sales.mm.given')}</p>
          <p dir="ltr" className="my-2 font-mono text-5xl font-extrabold tracking-wider text-slate-900">
            {confirmed.code}
          </p>
          <p className="text-sm text-green-800">{confirmed.on_router ? t('sales.mm.givenText') : t('sales.mm.givenAdding')}</p>
          <button type="button" className={`${textButtonClass} mt-1 text-green-800`} onClick={() => setConfirmed(null)}>
            {t('sales.pay.dismiss')}
          </button>
        </div>
      )}

      {!anyOpen && sites.data && (
        <Alert tone="info">{isOwner ? t('sales.mm.offOwner') : t('sales.mm.offStaff')}</Alert>
      )}

      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-lg font-bold">
          {t('sales.mm.toCheck')} {pending.length > 0 && <Badge color="blue">{pending.length}</Badge>}
        </h2>
        {payments.isLoading ? (
          <Spinner />
        ) : pending.length ? (
          <ul className="space-y-3">
            {pending.map((p) => (
              <WaitingPayment
                key={p.id}
                p={p}
                siteName={siteName(p.site_id)}
                planName={planName(p.plan_id)}
                onConfirmed={(r) => {
                  setConfirmed(r);
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
              />
            ))}
          </ul>
        ) : (
          <p className="rounded-2xl bg-white p-5 text-center text-slate-600 ring-1 ring-slate-200">{t('sales.mm.nothing')}</p>
        )}
        {payments.error && <Alert tone="error">{friendlyError(payments.error)}</Alert>}
      </section>

      {done.length > 0 && (
        <details className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <summary className="flex min-h-11 cursor-pointer items-center font-semibold text-slate-800">{t('sales.mm.earlier', { n: done.length })}</summary>
          <ul className="mt-2 divide-y divide-slate-100 text-sm">
            {done.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  <b className="tabular-nums">{formatSSP(p.amount_ssp)}</b> · {planName(p.plan_id)} · <span dir="ltr">{p.phone}</span> ·{' '}
                  <span dir="ltr" className="font-mono">
                    {p.momo_txn_id ?? p.txn_ref}
                  </span>
                  <span className="block text-xs text-slate-500">
                    {formatJubaTime(p.decided_at ?? p.created_at)}
                    {p.status === 'rejected' && p.reject_reason ? ` · ${p.reject_reason}` : ''}
                  </span>
                </span>
                <Badge color={PAYMENT_STATUS[p.status].color}>{PAYMENT_STATUS[p.status].label}</Badge>
              </li>
            ))}
          </ul>
        </details>
      )}

      {isOwner && <MomoSettings />}

      {isOwner && (
        <Card className="space-y-3">
          <h2 className="text-lg font-bold">{t('sales.mm.setupTitle')}</h2>
          <p className="text-sm text-slate-600">{t('sales.mm.setupText')}</p>
          {(sites.data ?? []).map((s) => (
            <BuySettings key={s.id} site={s} />
          ))}
        </Card>
      )}
    </div>
  );
}
