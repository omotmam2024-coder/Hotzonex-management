import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import qrcode from 'qrcode-generator';
import { useAuth } from '../../auth/AuthProvider';
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

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-bold">{site.name}</h3>
        {live ? <Badge color="green">{t('sales.buy.open')}</Badge> : <Badge color="gray">{t('sales.buy.closed')}</Badge>}
      </div>
      <Checkbox label={t('sales.buy.enable')} checked={enabled} onChange={setEnabled} />
      {enabled && (
        <>
          <Field label={t('sales.buy.address')} hint={`${window.location.origin}/buy/${slug || '…'}`}>
            <TextInput dir="ltr" value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40))} />
          </Field>
          <Field label={t('sales.buy.sendMoney')} hint={t('sales.buy.sendMoneyHint')}>
            <TextArea value={instructions} onChange={(e) => setInstructions(e.target.value.slice(0, 500))} rows={3} />
          </Field>
        </>
      )}
      <Button onClick={() => save.mutate()} disabled={save.isPending}>
        {save.isPending && <Spinner />} {t('common.save')}
      </Button>
      {save.isSuccess && (
        <Alert tone="success">
          {t('sales.buy.saved')} {enabled ? t('sales.buy.savedOpen') : t('sales.buy.savedClosed')}
        </Alert>
      )}
      {save.error && <Alert tone="error">{friendlyError(save.error)}</Alert>}
      {live && (
        <div className="flex flex-wrap items-center gap-4 pt-2">
          <div className="h-32 w-32" dangerouslySetInnerHTML={{ __html: svg }} />
          <div className="space-y-2">
            <a href={buyUrl(site.buy_slug!)} target="_blank" rel="noopener" className="block break-all font-semibold text-brand-700 underline">
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
      )}
    </div>
  );
}

function PaymentItem({
  p,
  siteName,
  planName,
  onAction,
  onConfirmed,
}: {
  p: PaymentRow;
  siteName: string;
  planName: string;
  onAction: () => void;
  onConfirmed: (result: ConfirmResult) => void;
}) {
  const { t } = useT();
  const queryClient = useQueryClient();
  // A double tap must not confirm twice: the second tap comes before isPending re-renders.
  const inFlight = useRef(false);
  const confirm = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('confirm_payment_request', { p_id: p.id });
      if (error) throw new Error(friendlyError(error));
      return fromJson<ConfirmResult>(data);
    },
    // Reported to the page: the row moves to "Recent" and remounts, which would lose its own state.
    onSuccess: (result) => {
      onConfirmed(result);
      void queryClient.invalidateQueries({ queryKey: ['payments'] });
      invalidateSalesData(queryClient);
    },
  });
  function confirmPayment() {
    if (inFlight.current) return;
    if (!window.confirm(t('sales.pay.confirmQuestion', { amount: formatSSP(p.amount_ssp), phone: p.phone, ref: p.txn_ref }))) return;
    inFlight.current = true;
    onAction();
    confirm.mutate(undefined, { onSettled: () => (inFlight.current = false) });
  }
  const reject = useMutation({
    mutationFn: async (reason: string) => {
      const { error } = await supabase.rpc('reject_payment_request', { p_id: p.id, p_reason: reason });
      if (error) throw new Error(friendlyError(error));
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['payments'] }),
  });

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-slate-900">
            {planName} · {formatSSP(p.amount_ssp)}
          </p>
          <p className="text-sm text-slate-700">
            {PROVIDER[p.provider] ?? p.provider} · <span dir="ltr">{p.phone}</span> · {t('sales.pay.ref')} <b className="font-mono">{p.txn_ref}</b>
          </p>
          <p className="text-xs text-slate-500">
            {siteName} · {formatJubaTime(p.created_at)}
          </p>
          {p.status === 'rejected' && p.reject_reason && <p className="text-sm text-red-700">{t('sales.pay.rejected', { reason: p.reject_reason })}</p>}
        </div>
        {p.status === 'pending' ? (
          <div className="flex gap-2">
            <Button
              onClick={confirmPayment}
              disabled={confirm.isPending || reject.isPending}
            >
              {confirm.isPending && <Spinner />} {t('sales.pay.confirm')}
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                const reason = window.prompt(t('sales.pay.rejectWhy'), t('sales.pay.rejectDefault'));
                if (!reason) return;
                onAction();
                reject.mutate(reason);
              }}
              disabled={confirm.isPending || reject.isPending}
            >
              {t('sales.pay.reject')}
            </Button>
          </div>
        ) : (
          <Badge color={PAYMENT_STATUS[p.status].color}>{PAYMENT_STATUS[p.status].label}</Badge>
        )}
      </div>
      {(confirm.error ?? reject.error) && <Alert tone="error">{friendlyError(confirm.error ?? reject.error)}</Alert>}
    </li>
  );
}

export function PaymentsPage() {
  const { t } = useT();
  const { profile } = useAuth();
  const sites = useSites();
  const plans = usePlans();
  // The last confirmed card, kept here: the confirmed row moves to "Recent" and remounts.
  const [confirmed, setConfirmed] = useState<ConfirmResult | null>(null);
  const clearConfirmed = () => setConfirmed(null);
  const payments = useQuery({
    queryKey: ['payments'],
    refetchInterval: 10_000,
    queryFn: async (): Promise<PaymentRow[]> => {
      const { data, error } = await supabase
        .from('payment_requests')
        .select('id, site_id, plan_id, amount_ssp, phone, provider, txn_ref, status, reject_reason, created_at, decided_at')
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

  return (
    <div className="space-y-4">
      <PageHeader title={t('nav.payments')} subtitle={t('sales.pay.subtitle')} />
      {confirmed && (
        <Alert tone="success">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>
              {t('sales.pay.givenCard')} <b className="font-mono">{confirmed.code}</b> {confirmed.on_router ? t('sales.pay.givenDone') : t('sales.pay.givenAdding')}
            </span>
            <button type="button" className={`${textButtonClass} text-green-800`} onClick={clearConfirmed}>
              {t('sales.pay.dismiss')}
            </button>
          </div>
        </Alert>
      )}
      <Card>
        <h2 className="mb-2 text-lg font-bold">{t('payment.pending')} {pending.length > 0 && <Badge color="blue">{pending.length}</Badge>}</h2>
        {payments.isLoading ? (
          <Spinner />
        ) : pending.length ? (
          <ul className="divide-y divide-slate-100">
            {pending.map((p) => (
              <PaymentItem key={p.id} p={p} siteName={siteName(p.site_id)} planName={planName(p.plan_id)} onAction={clearConfirmed} onConfirmed={setConfirmed} />
            ))}
          </ul>
        ) : (
          <p className="text-slate-600">{t('sales.pay.none')}</p>
        )}
        {payments.error && <Alert tone="error">{friendlyError(payments.error)}</Alert>}
      </Card>

      {done.length > 0 && (
        <Card>
          <h2 className="mb-2 text-lg font-bold">{t('sales.pay.recent')}</h2>
          <ul className="divide-y divide-slate-100">
            {done.map((p) => (
              <PaymentItem key={p.id} p={p} siteName={siteName(p.site_id)} planName={planName(p.plan_id)} onAction={clearConfirmed} onConfirmed={setConfirmed} />
            ))}
          </ul>
        </Card>
      )}

      {profile?.role === 'admin' && (
        <Card className="space-y-3">
          <h2 className="text-lg font-bold">{t('sales.buy.title')}</h2>
          <p className="text-sm text-slate-600">
            {t('sales.buy.intro')}
          </p>
          {(sites.data ?? []).map((s) => (
            <BuySettings key={s.id} site={s} />
          ))}
        </Card>
      )}
    </div>
  );
}
