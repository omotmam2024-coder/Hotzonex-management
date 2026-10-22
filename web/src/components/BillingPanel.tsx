import { useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useBillingOverview, type BillingOverview, type Invoice } from '../hooks/useBillingOverview';
import { friendlyError } from '../lib/errors';
import { useT } from '../i18n';
import { formatJubaDate, formatSSPWithUsd } from '../lib/format';
import { supabase } from '../lib/supabase';
import { OwnerPlanUsage } from './PlanLimits';
import { Alert, Badge, Button, buttonClass, Card, Spinner, TextInput } from './ui';
import { paymentRefSchema, validate } from '../lib/validation';

export const INVOICE_STATUS = {
  open: { key: 'business.billing.status.open', color: 'red' },
  paid: { key: 'business.billing.status.paid', color: 'green' },
  void: { key: 'business.billing.status.void', color: 'gray' },
} as const;

export function daysLeft(iso: string | null): number | null {
  if (!iso) return null;
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86400_000));
}

/** "I have paid": the transaction ID from the payment SMS, checked by Hotzonex Cloud. */
export function PayForm({ invoice }: { invoice: Invoice }) {
  const { t } = useT();
  const queryClient = useQueryClient();
  const [ref, setRef] = useState('');
  // Blocks a second tap before the button disables.
  const inFlight = useRef(false);
  const send = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('submit_invoice_payment', { p_invoice_id: invoice.id, p_ref: validate(paymentRefSchema, ref) });
      if (error) throw new Error(friendlyError(error));
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['billing'] }),
    onSettled: () => {
      inFlight.current = false;
    },
  });
  function submit() {
    if (inFlight.current) return;
    inFlight.current = true;
    send.mutate();
  }
  if (invoice.customer_ref) {
    return (
      <Alert tone="info">
        {t('business.bill.refSent')} <b dir="ltr" className="font-mono">{invoice.customer_ref}</b>. {t('business.bill.refChecking')}
      </Alert>
    );
  }
  return (
    <div className="space-y-2 rounded-xl bg-brand-50 p-3 ring-1 ring-brand-100">
      <label htmlFor={`ref-${invoice.id}`} className="block text-sm font-semibold text-slate-800">
        {t('business.bill.refLabel')}
      </label>
      <div className="flex flex-wrap gap-2">
        <div className="min-w-0 flex-1 basis-48">
          <TextInput
            id={`ref-${invoice.id}`}
            value={ref}
            onChange={(e) => setRef(e.target.value)}
            placeholder={t('business.billing.refPlaceholder')}
            autoCapitalize="characters"
            dir="ltr"
            className="font-mono text-lg"
          />
        </div>
        <Button onClick={submit} disabled={send.isPending || ref.trim().length < 4} className="min-h-12">
          {send.isPending && <Spinner />} {t('business.billing.iPaid')}
        </Button>
      </div>
      {send.error && <Alert tone="error">{friendlyError(send.error)}</Alert>}
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 border-b border-slate-100 py-2.5 last:border-0">
      <dt className="text-slate-600">{label}</dt>
      <dd className="text-end font-semibold text-slate-900">{children}</dd>
    </div>
  );
}

/** The one-line state of the account, in big letters. */
function StatusHero({ b, openCount }: { b: BillingOverview; openCount: number }) {
  const { t } = useT();
  const left = daysLeft(b.trial_ends_at);
  let tone = 'bg-green-50 text-green-800 ring-green-200';
  let title = t('business.bill.hero.ok');
  let text = t('business.bill.hero.okText');
  if (b.exempt) {
    title = t('business.bill.hero.included');
    text = t('business.billing.exemptText');
  } else if (b.status === 'suspended') {
    tone = 'bg-red-50 text-red-800 ring-red-200';
    title = t('business.bill.hero.paused');
    text = t('business.bill.hero.pausedText');
  } else if (openCount > 0) {
    tone = 'bg-amber-50 text-amber-900 ring-amber-200';
    title = t(openCount === 1 ? 'business.bill.hero.toPayOne' : 'business.bill.hero.toPay', { n: openCount });
    text = t('business.bill.hero.toPayText');
  } else if (b.status === 'trial') {
    tone = 'bg-brand-50 text-brand-700 ring-brand-200';
    title = left === null ? t('business.billing.freeTrial') : t(left === 1 ? 'business.bill.hero.trialOne' : 'business.bill.hero.trial', { n: left });
    text = b.trial_ends_at ? t('business.bill.hero.trialText', { date: formatJubaDate(b.trial_ends_at) }) : '';
  }
  return (
    <div className={`rounded-2xl p-4 ring-1 ${tone}`}>
      <div className="text-2xl font-extrabold">{title}</div>
      {text && <p className="mt-1 text-sm">{text}</p>}
    </div>
  );
}

/** The business's account with Hotzonex Cloud: state, price, next invoice, invoices and how to pay. */
/** invoiceLinks: false on the paused-app screen, where other pages cannot open. */
export function BillingPanel({ invoiceLinks = true }: { invoiceLinks?: boolean }) {
  const { t } = useT();
  const billing = useBillingOverview();
  if (billing.error) return <Alert tone="error">{friendlyError(billing.error)}</Alert>;
  const b = billing.data;
  if (!b) return billing.fetchStatus === 'paused' ? <Alert tone="warning">{t('business.billing.offline')}</Alert> : <Spinner />;
  const open = b.invoices.filter((i) => i.status === 'open');
  const money = (n: number) => formatSSPWithUsd(n, b.usd_rate);

  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <StatusHero b={b} openCount={open.length} />
        {!b.exempt && (
          <dl className="text-sm">
            {b.plan_name && <Row label={t('business.bill.plan')}>{b.plan_name}</Row>}
            <Row label={t('business.bill.price')}>{b.price_per_router_ssp > 0 ? t('business.bill.perRouter', { price: money(b.price_per_router_ssp) }) : t('business.billing.noFee')}</Row>
            <Row label={t('business.bill.routers')}>{b.routers}</Row>
            {b.next_invoice_on && (b.next_invoice_amount ?? 0) > 0 && (
              <Row label={t('business.bill.next')}>
                {formatJubaDate(b.next_invoice_on)} · {money(b.next_invoice_amount ?? 0)}
              </Row>
            )}
          </dl>
        )}
      </Card>

      {!b.exempt && (
        <Card>
          <h2 className="mb-2 flex items-center gap-2 text-lg font-bold">
            {t('business.billing.invoices')} {open.length > 0 && <Badge color="red">{t('business.billing.openCount', { n: open.length })}</Badge>}
          </h2>
          {b.invoices.length === 0 ? (
            <p className="rounded-xl bg-slate-50 p-4 text-slate-700">
              {b.next_invoice_on ? t('business.bill.noneYetOn', { date: formatJubaDate(b.next_invoice_on) }) : t('business.bill.noneYet')}
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {b.invoices.map((i) => (
                <li key={i.id} className="space-y-2 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2 font-semibold text-slate-900">
                        <span dir="ltr">{i.number}</span>
                        <Badge color={INVOICE_STATUS[i.status].color}>{t(INVOICE_STATUS[i.status].key)}</Badge>
                      </p>
                      <p className="text-sm text-slate-600">
                        {formatJubaDate(i.period_start)} – {formatJubaDate(i.period_end)}
                        {i.status === 'open' && ` · ${t('business.bill.dueOn', { date: formatJubaDate(i.due_at) })}`}
                      </p>
                    </div>
                    <div className="flex w-full flex-wrap items-center justify-between gap-2 sm:w-auto sm:flex-col sm:items-end">
                      <span className="text-lg font-extrabold tabular-nums text-slate-900">{money(i.amount_ssp)}</span>
                      {invoiceLinks && (
                        <Link to={`/billing/invoice/${i.id}`} className={buttonClass('secondary')}>
                          {t('business.bill.view')}
                        </Link>
                      )}
                    </div>
                  </div>
                  {i.status === 'open' && <PayForm invoice={i} />}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {!b.exempt && b.instructions && (
        <Card className="space-y-3">
          <h2 className="text-lg font-bold">{t('business.bill.howTitle')}</h2>
          <ol className="space-y-3">
            {[
              <span key="1" className="whitespace-pre-line">{b.instructions}</span>,
              <span key="2">{t('business.bill.step2')}</span>,
              <span key="3">{t('business.bill.step3')}</span>,
            ].map((content, n) => (
              <li key={n} className="flex gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-600 text-sm font-bold text-white">{n + 1}</span>
                <span className="pt-1 text-slate-800">{content}</span>
              </li>
            ))}
          </ol>
        </Card>
      )}

      <OwnerPlanUsage />
    </div>
  );
}
