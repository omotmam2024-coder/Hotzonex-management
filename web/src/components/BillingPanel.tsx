import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useBillingOverview, type Invoice } from '../hooks/useBillingOverview';
import { friendlyError } from '../lib/errors';
import { formatJubaDate, formatJubaTime, formatSSP } from '../lib/format';
import { supabase } from '../lib/supabase';
import { OwnerPlanUsage } from './PlanLimits';
import { Alert, Badge, Button, Card, Spinner, TextInput } from './ui';
import { paymentRefSchema, validate } from '../lib/validation';

export function daysLeft(iso: string | null): number | null {
  if (!iso) return null;
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86400_000));
}

function PayForm({ invoice }: { invoice: Invoice }) {
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
        <TextInput value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Transaction ID of your payment" autoCapitalize="characters" />
      </div>
      <Button onClick={submit} disabled={send.isPending || ref.trim().length < 4}>
        {send.isPending && <Spinner />} I have paid
      </Button>
      {send.error && <Alert tone="error">{friendlyError(send.error)}</Alert>}
    </div>
  );
}

/** The business's plan and invoices, and how to pay them. */
export function BillingPanel() {
  const billing = useBillingOverview();
  if (billing.error) return <Alert tone="error">{friendlyError(billing.error)}</Alert>;
  const b = billing.data;
  if (!b)
    return billing.fetchStatus === 'paused' ? <Alert tone="warning">No internet connection. Billing loads when you are back online.</Alert> : <Spinner />;
  const open = b.invoices.filter((i) => i.status === 'open');
  const left = daysLeft(b.trial_ends_at);

  return (
    <div className="space-y-4">
      <OwnerPlanUsage />
      <Card className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-bold">Payment</h2>
          {b.exempt ? (
            <Badge color="green">Included</Badge>
          ) : b.status === 'trial' ? (
            <Badge color="blue">Free trial{left !== null ? ` · ${left} day${left === 1 ? '' : 's'} left` : ''}</Badge>
          ) : b.status === 'suspended' ? (
            <Badge color="red">Paused: invoice unpaid</Badge>
          ) : (
            <Badge color="green">Active</Badge>
          )}
        </div>
        {b.exempt ? (
          <p className="text-slate-700">Hotzonex Cloud is included for your business. Nothing to pay.</p>
        ) : (
          <p className="text-slate-700">
            {b.price_per_router_ssp > 0
              ? `${formatSSP(b.price_per_router_ssp)} per connected router per month · ${b.routers} router${b.routers === 1 ? '' : 's'} now.`
              : 'No monthly fee is set yet.'}
            {b.status === 'trial' && b.trial_ends_at && ` The free trial ends on ${formatJubaTime(b.trial_ends_at)}.`}
          </p>
        )}
        {b.instructions && !b.exempt && (
          <Alert tone="warning">
            <b>How to pay:</b> <span className="whitespace-pre-line">{b.instructions}</span>
          </Alert>
        )}
      </Card>

      {b.invoices.length > 0 && (
        <Card>
          <h2 className="mb-2 text-lg font-bold">Invoices {open.length > 0 && <Badge color="red">{open.length} open</Badge>}</h2>
          <ul className="divide-y divide-slate-100">
            {b.invoices.map((i) => (
              <li key={i.id} className="py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-slate-900">
                      {i.number} · {formatSSP(i.amount_ssp)}
                    </p>
                    <p className="text-sm text-slate-600">
                      {formatJubaDate(i.period_start)} – {formatJubaDate(i.period_end)} · {i.routers} router{i.routers === 1 ? '' : 's'} × {formatSSP(i.price_per_router_ssp)}
                    </p>
                    {i.status === 'open' && <p className="text-sm text-slate-600">Due {formatJubaTime(i.due_at)}</p>}
                    {i.status === 'open' && i.customer_ref && (
                      <p className="text-sm text-brand-800">
                        You sent ref <b className="font-mono">{i.customer_ref}</b> — Hotzonex Cloud is checking it.
                      </p>
                    )}
                  </div>
                  <Badge color={i.status === 'paid' ? 'green' : i.status === 'open' ? 'red' : 'gray'}>{i.status}</Badge>
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
