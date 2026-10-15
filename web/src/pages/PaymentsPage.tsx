import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import qrcode from 'qrcode-generator';
import { useAuth } from '../auth/AuthProvider';
import { PageHeader } from '../components/PageHeader';
import { Alert, Badge, Button, Card, Checkbox, Field, Spinner, TextInput } from '../components/ui';
import { friendlyError } from '../lib/errors';
import { formatJubaTime, formatNumber } from '../lib/format';
import { invalidateSalesData, usePlans, useSites } from '../lib/queries';
import { supabase, supabaseUrl } from '../lib/supabase';
import type { SiteRow } from '../lib/types';

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

const PROVIDER: Record<string, string> = { mtn_momo: 'MTN MoMo', mgurush: 'm-Gurush', digicash: 'Digicash', other: 'Other' };

function buyUrl(slug: string) {
  return `${window.location.origin}/buy/${slug}`;
}

function qrSvg(text: string, cell = 6): string {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: cell, margin: 2, scalable: true });
}

function slugFrom(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .padEnd(3, '0');
}

/** A printable A4 poster: the QR code and link to the Buy page. */
function printPoster(site: SiteRow, business: string) {
  const url = buyUrl(site.buy_slug ?? '');
  const esc = (t: string) => t.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const w = window.open('', '_blank');
  if (!w) return;
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Buy WiFi – ${esc(site.name)}</title>
<style>body{font-family:system-ui,sans-serif;text-align:center;margin:40px}h1{font-size:44px;margin:0 0 8px}p{font-size:22px;margin:8px 0}
.qr{width:420px;margin:24px auto}.qr svg{width:100%;height:auto}.url{font-size:20px;font-weight:700;word-break:break-all}</style></head>
<body><h1>Buy WiFi here</h1><p>${esc(business)} · ${esc(site.name)}</p><div class="qr">${qrSvg(url, 10)}</div>
<p>1. Scan the code (or open the link) &nbsp; 2. Pay by mobile money &nbsp; 3. Get your card on your phone</p><p class="url">${esc(url)}</p>
<script>window.onload=()=>window.print()</script></body></html>`);
  w.document.close();
}

function BuySettings({ site }: { site: SiteRow }) {
  const { business } = useAuth();
  const queryClient = useQueryClient();
  const [enabled, setEnabled] = useState(site.buy_enabled);
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
        {live ? <Badge color="green">Open</Badge> : <Badge color="gray">Closed</Badge>}
      </div>
      <Checkbox label="Customers can buy cards here with mobile money" checked={enabled} onChange={setEnabled} />
      {enabled && (
        <>
          <Field label="Page address" hint={`${window.location.origin}/buy/${slug || '…'}`}>
            <TextInput value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40))} />
          </Field>
          <Field label="Where to send the money" hint="Shown to customers. For example: MTN MoMo 092 123 4567 (Hotzonex WiFi)">
            <textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value.slice(0, 500))}
              rows={3}
              className="w-full rounded-xl border border-slate-300 p-3 text-base focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
            />
          </Field>
        </>
      )}
      <Button onClick={() => save.mutate()} disabled={save.isPending}>
        {save.isPending && <Spinner />} Save
      </Button>
      {save.isSuccess && (
        <Alert tone="success">
          Saved. {enabled ? 'The routers of this site now let customers open the page before they log in.' : 'The page is closed.'}
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
            <Button variant="secondary" onClick={() => printPoster(site, business?.name ?? '')}>
              Print poster
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function PaymentItem({ p, siteName, planName }: { p: PaymentRow; siteName: string; planName: string }) {
  const queryClient = useQueryClient();
  const confirm = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('confirm_payment_request', { p_id: p.id });
      if (error) throw new Error(friendlyError(error));
      return data as { code: string; on_router: boolean };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['payments'] });
      invalidateSalesData(queryClient);
    },
  });
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
            {planName} · {formatNumber(p.amount_ssp)} SSP
          </p>
          <p className="text-sm text-slate-700">
            {PROVIDER[p.provider] ?? p.provider} · {p.phone} · ref <b className="font-mono">{p.txn_ref}</b>
          </p>
          <p className="text-xs text-slate-500">
            {siteName} · {formatJubaTime(p.created_at)}
          </p>
          {p.status === 'rejected' && p.reject_reason && <p className="text-sm text-red-700">Rejected: {p.reject_reason}</p>}
        </div>
        {p.status === 'pending' ? (
          <div className="flex gap-2">
            <Button
              onClick={() => window.confirm(`Did ${formatNumber(p.amount_ssp)} SSP arrive from ${p.phone} with ref ${p.txn_ref}?`) && confirm.mutate()}
              disabled={confirm.isPending || reject.isPending}
            >
              {confirm.isPending && <Spinner />} Confirm
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                const reason = window.prompt('Why? The customer sees this.', 'Payment not received');
                if (reason) reject.mutate(reason);
              }}
              disabled={confirm.isPending || reject.isPending}
            >
              Reject
            </Button>
          </div>
        ) : (
          <Badge color={p.status === 'confirmed' ? 'green' : p.status === 'rejected' ? 'red' : 'gray'}>{p.status}</Badge>
        )}
      </div>
      {confirm.data && (
        <Alert tone="success">
          Card <b className="font-mono">{confirm.data.code}</b> given — the customer sees it on their page
          {confirm.data.on_router ? '.' : ' (it is being added to the router, about a minute).'}
        </Alert>
      )}
      {(confirm.error ?? reject.error) && <Alert tone="error">{friendlyError(confirm.error ?? reject.error)}</Alert>}
    </li>
  );
}

export function PaymentsPage() {
  const { profile } = useAuth();
  const sites = useSites();
  const plans = usePlans();
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
  const planName = (id: string) => plans.data?.find((p) => p.id === id)?.name ?? 'Card';
  const pending = (payments.data ?? []).filter((p) => p.status === 'pending');
  const done = (payments.data ?? []).filter((p) => p.status !== 'pending').slice(0, 30);

  return (
    <div className="space-y-4">
      <PageHeader title="Payments" subtitle="Customers who bought a card by mobile money. Check the money arrived, then Confirm." />
      <Card>
        <h2 className="mb-2 text-lg font-bold">To confirm {pending.length > 0 && <Badge color="blue">{pending.length}</Badge>}</h2>
        {payments.isLoading ? (
          <Spinner />
        ) : pending.length ? (
          <ul className="divide-y divide-slate-100">
            {pending.map((p) => (
              <PaymentItem key={p.id} p={p} siteName={siteName(p.site_id)} planName={planName(p.plan_id)} />
            ))}
          </ul>
        ) : (
          <p className="text-slate-600">No payments waiting.</p>
        )}
        {payments.error && <Alert tone="error">{friendlyError(payments.error)}</Alert>}
      </Card>

      {done.length > 0 && (
        <Card>
          <h2 className="mb-2 text-lg font-bold">Recent</h2>
          <ul className="divide-y divide-slate-100">
            {done.map((p) => (
              <PaymentItem key={p.id} p={p} siteName={siteName(p.site_id)} planName={planName(p.plan_id)} />
            ))}
          </ul>
        </Card>
      )}

      {profile?.role === 'admin' && (
        <Card className="space-y-3">
          <h2 className="text-lg font-bold">Buy page</h2>
          <p className="text-sm text-slate-600">
            Customers open the page (QR poster, or from the WiFi before they log in), pay to your mobile-money number and type the transaction ID.
            You get an alert; the card appears on their phone when you confirm. Cards come from the site's stock, or are made on the spot.
          </p>
          {(sites.data ?? []).map((s) => (
            <BuySettings key={s.id} site={s} />
          ))}
        </Card>
      )}
    </div>
  );
}
