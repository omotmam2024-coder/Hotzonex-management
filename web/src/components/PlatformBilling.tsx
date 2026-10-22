import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { friendlyError } from '../lib/errors';
import { useT } from '../i18n';
import { formatJubaDate, formatJubaTime, formatSSPWithUsd, jubaToday } from '../lib/format';
import { fromJson, supabase } from '../lib/supabase';
import { BusinessPlanControl, PlansCard } from './PlanLimits';
import { Alert, Badge, Button, Card, Checkbox, Field, Spinner, TextArea, TextInput } from './ui';

interface PlatformInvoice {
  id: string;
  number: string;
  period_start: string;
  period_end: string;
  routers: number;
  amount_ssp: number;
  status: 'open' | 'paid' | 'void';
  due_at: string;
  customer_ref: string | null;
  customer_ref_at: string | null;
  paid_at: string | null;
  paid_ref: string | null;
}

interface PlatformBusiness {
  tenant_id: string;
  name: string;
  is_active: boolean;
  status: 'trial' | 'active' | 'suspended' | null;
  exempt: boolean | null;
  trial_ends_at: string | null;
  price_per_router_ssp: number | null;
  created_via: string | null;
  contact_phone: string | null;
  routers: number;
  invoices: PlatformInvoice[];
}

interface PlatformBillingData {
  config: { price_per_router_ssp: number; instructions: string; grace_days: number; trial_days: number; usd_rate: number | null };
  businesses: PlatformBusiness[];
}

const KEY = ['platform-billing'];

const jubaParts = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Africa/Juba',
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

/** A moment's wall-clock parts in Juba. */
function jubaClock(date: Date) {
  const parts = jubaParts.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((x) => x.type === type)?.value ?? '00';
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute') };
}

/** The Juba calendar day (YYYY-MM-DD) of a timestamp. */
function jubaDay(iso: string): string {
  const c = jubaClock(new Date(iso));
  return `${c.year}-${c.month}-${c.day}`;
}

/** 23:59 Juba time on a YYYY-MM-DD day, as an ISO timestamp (Juba's UTC offset worked out, not hard-coded). */
function jubaEndOfDay(day: string): string {
  const guess = new Date(`${day}T23:59:00Z`);
  const c = jubaClock(guess);
  const offset = Date.UTC(Number(c.year), Number(c.month) - 1, Number(c.day), Number(c.hour), Number(c.minute)) - guess.getTime();
  return new Date(guess.getTime() - offset).toISOString();
}

function ConfigCard({ config }: { config: PlatformBillingData['config'] }) {
  const { t } = useT();
  const queryClient = useQueryClient();
  const [f, setF] = useState({ price: String(config.price_per_router_ssp), howto: config.instructions, grace: String(config.grace_days), trial: String(config.trial_days), usd: config.usd_rate === null ? '' : String(config.usd_rate) });
  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('platform_set_billing_config', {
        p_price: Number(f.price || 0),
        p_instructions: f.howto,
        p_grace_days: Number(f.grace || 0),
        p_trial_days: Number(f.trial || 0),
      });
      if (error) throw new Error(friendlyError(error));
      const rate = await supabase.rpc('platform_set_billing_usd_rate', { p_rate: f.usd.trim() === '' ? 0 : Number(f.usd) });
      if (rate.error) throw new Error(friendlyError(rate.error));
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: KEY }),
  });
  const rateNumber = Number(f.usd);
  const num = (k: 'price' | 'grace' | 'trial') => (e: React.ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x, [k]: e.target.value.replace(/\D/g, '').slice(0, 9) }));
  return (
    <Card className="space-y-3">
      <h2 className="text-lg font-bold">{t('business.pbilling.title')}</h2>
      <p className="text-sm text-slate-600">{t('business.pbilling.text')}</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={t('business.pbilling.price')}>
          <TextInput inputMode="numeric" value={f.price} onChange={num('price')} />
        </Field>
        <Field label={t('business.pbilling.grace')}>
          <TextInput inputMode="numeric" value={f.grace} onChange={num('grace')} />
        </Field>
        <Field label={t('business.pbilling.trialDays')}>
          <TextInput inputMode="numeric" value={f.trial} onChange={num('trial')} />
        </Field>
      </div>
      <Field
        label={t('business.pbilling.usdRate')}
        hint={rateNumber > 0 ? t('business.pbilling.usdRateExample', { price: formatSSPWithUsd(Number(f.price || 0), rateNumber) }) : t('business.pbilling.usdRateHint')}
      >
        <TextInput
          inputMode="decimal"
          dir="ltr"
          value={f.usd}
          placeholder="4500"
          onChange={(e) => setF((x) => ({ ...x, usd: e.target.value.replace(',', '.').replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1').replace(/(\.\d{2}).+/, '$1').slice(0, 10) }))}
        />
      </Field>
      <Field label={t('business.pbilling.howto')} hint={t('business.pbilling.howtoHint')}>
        <TextArea value={f.howto} onChange={(e) => setF((x) => ({ ...x, howto: e.target.value.slice(0, 500) }))} rows={2} />
      </Field>
      <Button onClick={() => save.mutate()} disabled={save.isPending}>
        {save.isPending && <Spinner />} {t('common.save')}
      </Button>
      {save.isSuccess && <Alert tone="success">{t('business.pbilling.saved')}</Alert>}
      {save.error && <Alert tone="error">{friendlyError(save.error)}</Alert>}
    </Card>
  );
}

function BusinessBilling({ b, stdPrice, usdRate }: { b: PlatformBusiness; stdPrice: number; usdRate: number | null }) {
  const { t } = useT();
  const queryClient = useQueryClient();
  const [exempt, setExempt] = useState(Boolean(b.exempt));
  const [price, setPrice] = useState(b.price_per_router_ssp === null ? '' : String(b.price_per_router_ssp));
  const [trialEnd, setTrialEnd] = useState(b.trial_ends_at ? jubaDay(b.trial_ends_at) : '');
  // After a refetch, show what is saved.
  useEffect(() => setExempt(Boolean(b.exempt)), [b.exempt]);
  useEffect(() => setPrice(b.price_per_router_ssp === null ? '' : String(b.price_per_router_ssp)), [b.price_per_router_ssp]);
  useEffect(() => setTrialEnd(b.trial_ends_at ? jubaDay(b.trial_ends_at) : ''), [b.trial_ends_at]);

  const save = useMutation({
    // trialOverride: a new trial end chosen with a shortcut (saved at once).
    mutationFn: async (trialOverride?: string) => {
      const day = trialOverride ?? trialEnd;
      const { error } = await supabase.rpc('platform_set_business_billing', {
        p_tenant_id: b.tenant_id,
        p_exempt: exempt,
        p_price: price.trim() === '' ? null : Number(price),
        p_trial_ends_at: day ? jubaEndOfDay(day) : null,
      });
      if (error) throw new Error(friendlyError(error));
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: KEY }),
  });
  // From the later of today and the current trial end.
  function extendTrial(days: number) {
    const today = jubaToday();
    const from = trialEnd && trialEnd > today ? trialEnd : today;
    const end = new Date(`${from}T12:00:00Z`);
    end.setUTCDate(end.getUTCDate() + days);
    const next = end.toISOString().slice(0, 10);
    if (!window.confirm(t('business.pbilling.confirmTrial', { name: b.name, date: formatJubaDate(next) }))) return;
    setTrialEnd(next);
    save.mutate(next);
  }

  const mark = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: 'paid' | 'void' }) => {
      const { error } = await supabase.rpc('platform_mark_invoice', { p_invoice_id: id, p_status: status, p_ref: null });
      if (error) throw new Error(friendlyError(error));
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: KEY }),
    onSettled: () => {
      markInFlight.current = false;
    },
  });
  // Blocks a second tap before the button disables.
  const markInFlight = useRef(false);
  function markInvoice(id: string, status: 'paid' | 'void', question: string) {
    if (markInFlight.current || !window.confirm(question)) return;
    markInFlight.current = true;
    mark.mutate({ id, status });
  }

  return (
    <li className="space-y-2 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-slate-900">{b.name}</span>
        {b.exempt ? (
          <Badge color="gray">{t('business.pbilling.notBilled')}</Badge>
        ) : b.status === 'trial' ? (
          <Badge color="blue">{b.trial_ends_at ? t('business.pbilling.trialTo', { date: formatJubaTime(b.trial_ends_at) }) : t('business.pbilling.trial')}</Badge>
        ) : b.status === 'suspended' ? (
          <Badge color="red">{t('business.pbilling.paused')}</Badge>
        ) : (
          <Badge color="green">{t('business.billing.active')}</Badge>
        )}
        <span className="text-sm text-slate-500">
          {t(b.routers === 1 ? 'business.limits.router' : 'business.limits.routers', { n: b.routers })}
          {b.created_via === 'signup' && t('business.pbilling.signedUp')}
          {b.contact_phone && (
            <>
              {' · '}
              <span dir="ltr">{b.contact_phone}</span>
            </>
          )}
        </span>
      </div>
      <div className="grid gap-2 sm:grid-cols-[auto_12rem_12rem_auto] sm:items-end">
        <Checkbox label={t('business.pbilling.notBilled')} checked={exempt} onChange={setExempt} />
        <Field label={t('business.pbilling.ownPrice')} hint={t('business.limits.emptyStandard', { price: formatSSPWithUsd(stdPrice, usdRate) })}>
          <TextInput inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value.replace(/\D/g, '').slice(0, 9))} />
        </Field>
        <Field label={t('business.pbilling.trialUntil')}>
          <TextInput type="date" value={trialEnd} onChange={(e) => setTrialEnd(e.target.value)} />
        </Field>
        <Button variant="secondary" onClick={() => save.mutate(undefined)} disabled={save.isPending}>
          {save.isPending && <Spinner />} {t('common.save')}
        </Button>
      </div>
      <BusinessPlanControl tenantId={b.tenant_id} onExtendTrial={extendTrial} />
      {save.error && <Alert tone="error">{friendlyError(save.error)}</Alert>}
      {b.invoices.length > 0 && (
        <ul className="space-y-1 rounded-xl bg-slate-50 p-3 text-sm">
          {b.invoices.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center justify-between gap-2">
              <span>
                <b>{i.number}</b> · {formatSSPWithUsd(i.amount_ssp, usdRate)} · {t(i.routers === 1 ? 'business.limits.router' : 'business.limits.routers', { n: i.routers })} ·{' '}
                {i.status === 'open'
                  ? t('business.pbilling.due', { date: formatJubaTime(i.due_at) })
                  : i.status === 'paid'
                    ? i.paid_ref
                      ? t('business.pbilling.paidRef', { ref: i.paid_ref })
                      : t('business.pbilling.paid')
                    : t('business.pbilling.void')}
                {i.status === 'open' && i.customer_ref && (
                  <span className="ms-1 font-semibold text-brand-800">{t('business.pbilling.saysPaid', { ref: i.customer_ref })}</span>
                )}
              </span>
              {i.status === 'open' && (
                <span className="flex gap-2">
                  <Button
                    onClick={() => markInvoice(i.id, 'paid', t('business.pbilling.confirmPaid', { amount: formatSSPWithUsd(i.amount_ssp, usdRate), number: i.number }))}
                    disabled={mark.isPending}
                  >
                    {t('business.pbilling.markPaid')}
                  </Button>
                  <Button variant="ghost" onClick={() => markInvoice(i.id, 'void', t('business.pbilling.confirmVoid', { number: i.number }))} disabled={mark.isPending}>
                    {t('business.pbilling.voidButton')}
                  </Button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {mark.error && <Alert tone="error">{friendlyError(mark.error)}</Alert>}
    </li>
  );
}

/** Platform admins: Hotzonex Cloud's own billing of the businesses. */
export function PlatformBilling() {
  const { t } = useT();
  const data = useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<PlatformBillingData> => {
      const { data, error } = await supabase.rpc('platform_billing');
      if (error) throw new Error(friendlyError(error));
      return fromJson<PlatformBillingData>(data);
    },
  });
  if (data.error) return <Alert tone="error">{friendlyError(data.error)}</Alert>;
  const d = data.data;
  if (!d) return data.fetchStatus === 'paused' ? <Alert tone="warning">{t('business.billing.offline')}</Alert> : <Spinner />;
  return (
    <div className="space-y-4">
      <ConfigCard config={d.config} />
      <PlansCard stdPrice={d.config.price_per_router_ssp} usdRate={d.config.usd_rate} />
      <Card>
        <h2 className="mb-1 text-lg font-bold">{t('business.pbilling.businesses')}</h2>
        <ul className="divide-y divide-slate-100">
          {d.businesses.map((b) => (
            <BusinessBilling key={b.tenant_id} b={b} stdPrice={d.config.price_per_router_ssp} usdRate={d.config.usd_rate} />
          ))}
        </ul>
      </Card>
    </div>
  );
}
