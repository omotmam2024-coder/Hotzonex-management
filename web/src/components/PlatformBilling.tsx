import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { friendlyError } from '../lib/errors';
import { formatJubaDate, formatJubaTime, formatSSP, jubaToday } from '../lib/format';
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
  config: { price_per_router_ssp: number; instructions: string; grace_days: number; trial_days: number };
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
  const queryClient = useQueryClient();
  const [f, setF] = useState({ price: String(config.price_per_router_ssp), howto: config.instructions, grace: String(config.grace_days), trial: String(config.trial_days) });
  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('platform_set_billing_config', {
        p_price: Number(f.price || 0),
        p_instructions: f.howto,
        p_grace_days: Number(f.grace || 0),
        p_trial_days: Number(f.trial || 0),
      });
      if (error) throw new Error(friendlyError(error));
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: KEY }),
  });
  const num = (k: 'price' | 'grace' | 'trial') => (e: React.ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x, [k]: e.target.value.replace(/\D/g, '').slice(0, 9) }));
  return (
    <Card className="space-y-3">
      <h2 className="text-lg font-bold">Billing for Hotzonex Cloud</h2>
      <p className="text-sm text-slate-600">
        Businesses pay a monthly fee per connected router. An invoice is made each month; unpaid after the grace days, the business is
        paused (its WiFi keeps working) until you mark the invoice paid. With the price at 0, nobody is invoiced.
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Price per router / month (SSP)">
          <TextInput inputMode="numeric" value={f.price} onChange={num('price')} />
        </Field>
        <Field label="Days to pay (grace)">
          <TextInput inputMode="numeric" value={f.grace} onChange={num('grace')} />
        </Field>
        <Field label="Free trial days (new sign-ups)">
          <TextInput inputMode="numeric" value={f.trial} onChange={num('trial')} />
        </Field>
      </div>
      <Field label="How businesses pay you" hint="Shown on their invoices, e.g. MTN MoMo 092 123 4567 (Hotzonex Cloud), reference = invoice number">
        <TextArea value={f.howto} onChange={(e) => setF((x) => ({ ...x, howto: e.target.value.slice(0, 500) }))} rows={2} />
      </Field>
      <Button onClick={() => save.mutate()} disabled={save.isPending}>
        {save.isPending && <Spinner />} Save
      </Button>
      {save.isSuccess && <Alert tone="success">Saved. Invoices are made each morning.</Alert>}
      {save.error && <Alert tone="error">{friendlyError(save.error)}</Alert>}
    </Card>
  );
}

function BusinessBilling({ b, stdPrice }: { b: PlatformBusiness; stdPrice: number }) {
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
    if (!window.confirm(`Free trial for ${b.name} until ${formatJubaDate(next)}?`)) return;
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
          <Badge color="gray">Not billed</Badge>
        ) : b.status === 'trial' ? (
          <Badge color="blue">Trial{b.trial_ends_at ? ` to ${formatJubaTime(b.trial_ends_at)}` : ''}</Badge>
        ) : b.status === 'suspended' ? (
          <Badge color="red">Paused (unpaid)</Badge>
        ) : (
          <Badge color="green">Active</Badge>
        )}
        <span className="text-sm text-slate-500">
          {b.routers} router{b.routers === 1 ? '' : 's'}
          {b.created_via === 'signup' && ' · signed up'}
          {b.contact_phone && ` · ${b.contact_phone}`}
        </span>
      </div>
      <div className="grid gap-2 sm:grid-cols-[auto_12rem_12rem_auto] sm:items-end">
        <Checkbox label="Not billed" checked={exempt} onChange={setExempt} />
        <Field label="Own price (SSP)" hint={`Empty: standard ${formatSSP(stdPrice)}`}>
          <TextInput inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value.replace(/\D/g, '').slice(0, 9))} />
        </Field>
        <Field label="Trial until">
          <TextInput type="date" value={trialEnd} onChange={(e) => setTrialEnd(e.target.value)} />
        </Field>
        <Button variant="secondary" onClick={() => save.mutate(undefined)} disabled={save.isPending}>
          {save.isPending && <Spinner />} Save
        </Button>
      </div>
      <BusinessPlanControl tenantId={b.tenant_id} onExtendTrial={extendTrial} />
      {save.error && <Alert tone="error">{friendlyError(save.error)}</Alert>}
      {b.invoices.length > 0 && (
        <ul className="space-y-1 rounded-xl bg-slate-50 p-3 text-sm">
          {b.invoices.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center justify-between gap-2">
              <span>
                <b>{i.number}</b> · {formatSSP(i.amount_ssp)} · {i.routers} router{i.routers === 1 ? '' : 's'} ·{' '}
                {i.status === 'open' ? `due ${formatJubaTime(i.due_at)}` : i.status === 'paid' ? `paid ${i.paid_ref ? `(ref ${i.paid_ref})` : ''}` : 'void'}
                {i.status === 'open' && i.customer_ref && (
                  <span className="ml-1 font-semibold text-brand-800">· says paid, ref {i.customer_ref}</span>
                )}
              </span>
              {i.status === 'open' && (
                <span className="flex gap-2">
                  <Button
                    onClick={() => markInvoice(i.id, 'paid', `Did ${formatSSP(i.amount_ssp)} for ${i.number} arrive?`)}
                    disabled={mark.isPending}
                  >
                    Mark paid
                  </Button>
                  <Button variant="ghost" onClick={() => markInvoice(i.id, 'void', `Cancel ${i.number}?`)} disabled={mark.isPending}>
                    Void
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
  if (!d) return data.fetchStatus === 'paused' ? <Alert tone="warning">No internet connection. Billing loads when you are back online.</Alert> : <Spinner />;
  return (
    <div className="space-y-4">
      <ConfigCard config={d.config} />
      <PlansCard stdPrice={d.config.price_per_router_ssp} />
      <Card>
        <h2 className="mb-1 text-lg font-bold">Businesses' billing</h2>
        <ul className="divide-y divide-slate-100">
          {d.businesses.map((b) => (
            <BusinessBilling key={b.tenant_id} b={b} stdPrice={d.config.price_per_router_ssp} />
          ))}
        </ul>
      </Card>
    </div>
  );
}
