import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useBillingOverview, type Invoice } from '../hooks/useBillingOverview';
import { friendlyError } from '../lib/errors';
import { useT } from '../i18n';
import { formatJubaDate, formatJubaTime, formatSSPWithUsd } from '../lib/format';
import { supabase } from '../lib/supabase';
import { OwnerPlanUsage } from './PlanLimits';
import { Alert, Badge, Button, Card, Spinner, TextInput } from './ui';
import { paymentRefSchema, validate } from '../lib/validation';

const STATUS_KEY = {
  open: 'business.billing.status.open',
  paid: 'business.billing.status.paid',
  void: 'business.billing.status.void',
} as const;

export function daysLeft(iso: string | null): number | null {
  if (!iso) return null;
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86400_000));
}

function PayForm({ invoice }: { invoice: Invoice }) {
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
  return (
    <div className="mt-2 flex flex-wrap items-end gap-2">
      <div className="min-w-48 flex-1">
        <TextInput value={ref} onChange={(e) => setRef(e.target.value)} placeholder={t('business.billing.refPlaceholder')}
          autoCapitalize="characters"
          dir="ltr"
        />
      </div>
      <Button onClick={submit} disabled={send.isPending || ref.trim().length < 4}>
        {send.isPending && <Spinner />} {t('business.billing.iPaid')}
      </Button>
      {send.error && <Alert tone="error">{friendlyError(send.error)}</Alert>}
    </div>
  );
}

/** The business's plan and invoices, and how to pay them. */
export function BillingPanel() {
  const { t } = useT();
  const billing = useBillingOverview();
  if (billing.error) return <Alert tone="error">{friendlyError(billing.error)}</Alert>;
  const b = billing.data;
  if (!b)
    return billing.fetchStatus === 'paused' ? <Alert tone="warning">{t('business.billing.offline')}</Alert> : <Spinner />;
  const open = b.invoices.filter((i) => i.status === 'open');
  const left = daysLeft(b.trial_ends_at);

  return (
    <div className="space-y-4">
      <OwnerPlanUsage />
      <Card className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-bold">{t('business.billing.payment')}</h2>
          {b.exempt ? (
            <Badge color="green">{t('business.billing.included')}</Badge>
          ) : b.status === 'trial' ? (
            <Badge color="blue">
              {left === null
                ? t('business.billing.freeTrial')
                : t(left === 1 ? 'business.billing.freeTrialLeftOne' : 'business.billing.freeTrialLeft', { n: left })}
            </Badge>
          ) : b.status === 'suspended' ? (
            <Badge color="red">{t('business.billing.paused')}</Badge>
          ) : (
            <Badge color="green">{t('business.billing.active')}</Badge>
          )}
        </div>
        {b.exempt ? (
          <p className="text-slate-700">{t('business.billing.exemptText')}</p>
        ) : (
          <p className="text-slate-700">
            {b.price_per_router_ssp > 0
              ? t(b.routers === 1 ? 'business.billing.priceLineOne' : 'business.billing.priceLine', { price: formatSSPWithUsd(b.price_per_router_ssp, b.usd_rate), n: b.routers })
              : t('business.billing.noFee')}
            {b.status === 'trial' && b.trial_ends_at && t('business.billing.trialEnds', { date: formatJubaTime(b.trial_ends_at) })}
          </p>
        )}
        {b.instructions && !b.exempt && (
          <Alert tone="warning">
            <b>{t('business.billing.howToPay')}</b> <span className="whitespace-pre-line">{b.instructions}</span>
          </Alert>
        )}
      </Card>

      {b.invoices.length > 0 && (
        <Card>
          <h2 className="mb-2 text-lg font-bold">
            {t('business.billing.invoices')} {open.length > 0 && <Badge color="red">{t('business.billing.openCount', { n: open.length })}</Badge>}
          </h2>
          <ul className="divide-y divide-slate-100">
            {b.invoices.map((i) => (
              <li key={i.id} className="py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-slate-900">
                      {i.number} · {formatSSPWithUsd(i.amount_ssp, b.usd_rate)}
                    </p>
                    <p className="text-sm text-slate-600">
                      {t(i.routers === 1 ? 'business.billing.invoiceLineOne' : 'business.billing.invoiceLine', {
                        start: formatJubaDate(i.period_start),
                        end: formatJubaDate(i.period_end),
                        n: i.routers,
                        price: formatSSPWithUsd(i.price_per_router_ssp, b.usd_rate),
                      })}
                    </p>
                    {i.status === 'open' && <p className="text-sm text-slate-600">{t('business.billing.due', { date: formatJubaTime(i.due_at) })}</p>}
                    {i.status === 'open' && i.customer_ref && (
                      <p className="text-sm text-brand-800">
                        {t('business.billing.sentRef')} <b dir="ltr" className="font-mono">{i.customer_ref}</b> {t('business.billing.checking')}
                      </p>
                    )}
                  </div>
                  <Badge color={i.status === 'paid' ? 'green' : i.status === 'open' ? 'red' : 'gray'}>{t(STATUS_KEY[i.status])}</Badge>
                </div>
                {i.status === 'open' && !i.customer_ref && <PayForm invoice={i} />}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
