import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { friendlyError } from '../lib/errors';
import { formatJubaTime, formatNumber } from '../lib/format';
import { supabase } from '../lib/supabase';
import { OwnerPlanUsage } from './PlanLimits';
import { Alert, Badge, Button, Card, Spinner, TextInput } from './ui';
import { paymentRefSchema, validate } from '../lib/validation';

export interface Invoice {
  id: string;
  number: string;
  period_start: string;
  period_end: string;
  routers: number;
  price_per_router_ssp: number;
  amount_ssp: number;
  status: 'open' | 'paid' | 'void';
  due_at: string;
  customer_ref: string | null;
  customer_ref_at: string | null;
  paid_at: string | null;
}

export interface BillingOverview {
  status: 'trial' | 'active' | 'suspended';
  exempt: boolean;
  trial_ends_at: string | null;
  price_per_router_ssp: number;
  routers: number;
  business_active: boolean;
  instructions: string;
  invoices: Invoice[];
}

export function useBillingOverview(enabled = true) {
  return useQuery({
    queryKey: ['billing'],
    enabled,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<BillingOverview> => {
      const { data, error } = await supabase.rpc('billing_overview');
      if (error) throw new Error(friendlyError(error));
      const b = (data ?? {}) as Partial<BillingOverview>;
      return { ...b, exempt: b.exempt ?? true, invoices: Array.isArray(b.invoices) ? b.invoices : [] } as BillingOverview;
    },
  });
}

export function daysLeft(iso: string | null): number | null {
  if (!iso) return null;
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86400_000));
}

const day = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

function PayForm({ invoice }: { invoice: Invoice }) {
  const queryClient = useQueryClient();
  const [ref, setRef] = useState('');
  const send = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('submit_invoice_payment', { p_invoice_id: invoice.id, p_ref: validate(paymentRefSchema, ref) });
      if (error) throw new Error(friendlyError(error));
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['billing'] }),
  });
  return (
    <div className="mt-2 flex flex-wrap items-end gap-2">
      <div className="min-w-48 flex-1">
        <TextInput value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Transaction ID of your payment" autoCapitalize="characters" />
      </div>
      <Button onClick={() => send.mutate()} disabled={send.isPending || ref.trim().length < 4}>
        {send.isPending && <Spinner />} I have paid
      </Button>
      {send.error && <Alert tone="error">{friendlyError(send.error)}</Alert>}
    </div>
  );
}

/** The business's plan and invoices, and how to pay them. */
export function BillingPanel() {
  const billing = useBillingOverview();
  if (billing.isLoading) return <Spinner />;
  if (billing.error) return <Alert tone="error">{friendlyError(billing.error)}</Alert>;
  const b = billing.data!;
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
              ? `${formatNumber(b.price_per_router_ssp)} SSP per connected router per month · ${b.routers} router${b.routers === 1 ? '' : 's'} now.`
              : 'No monthly fee is set yet.'}
            {b.status === 'trial' && b.trial_ends_at && ` The free trial ends on ${formatJubaTime(b.trial_ends_at)}.`}
          </p>
        )}
        {b.instructions && !b.exempt && (
          <div className="rounded-xl bg-amber-50 p-3 text-sm text-amber-950">
            <b>How to pay:</b> <span className="whitespace-pre-line">{b.instructions}</span>
          </div>
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
                      {i.number} · {formatNumber(i.amount_ssp)} SSP
                    </p>
                    <p className="text-sm text-slate-600">
                      {day(i.period_start)} – {day(i.period_end)} · {i.routers} router{i.routers === 1 ? '' : 's'} × {formatNumber(i.price_per_router_ssp)} SSP
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
