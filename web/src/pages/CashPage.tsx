import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthProvider';
import { PageHeader } from '../components/PageHeader';
import { Alert, Badge, Button, Card, Field, Select, Spinner, TextInput } from '../components/ui';
import { friendlyError } from '../lib/errors';
import { formatNumber } from '../lib/format';
import { useSites } from '../lib/queries';
import { supabase } from '../lib/supabase';
import { cashHandoverSchema, validate } from '../lib/validation';

interface CashRow {
  seller_id: string;
  name: string;
  role: string;
  site_name: string | null;
  commission_pct: number;
  credit_limit_ssp: number | null;
  cash_count: number;
  cash_amount: number;
  commission: number;
  to_hand_in: number;
  handed_in: number;
  difference: number;
  momo_count: number;
  momo_amount: number;
  held_now: number;
}

function todayInJuba(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Juba' }).format(new Date());
}

const ssp = (n: number) => `${formatNumber(n)} SSP`;

function ReceiveCash({ row, onDone }: { row: CashRow; onDone: () => void }) {
  const [amount, setAmount] = useState(row.held_now > 0 ? String(row.held_now) : '');
  const [note, setNote] = useState('');
  const receive = useMutation({
    mutationFn: async () => {
      const v = validate(cashHandoverSchema, { amount, note });
      const { error } = await supabase.rpc('record_cash_handover', { p_seller_id: row.seller_id, p_amount_ssp: v.amount, p_note: v.note || null });
      if (error) throw new Error(friendlyError(error));
    },
    onSuccess: onDone,
  });
  // A double tap must not record the cash twice.
  const inFlight = useRef(false);
  const save = () => {
    if (inFlight.current) return;
    inFlight.current = true;
    receive.mutate(undefined, { onSettled: () => (inFlight.current = false) });
  };
  return (
    <div className="mt-2 grid gap-2 rounded-xl bg-slate-50 p-3 sm:grid-cols-[10rem_1fr_auto] sm:items-end">
      <Field label="Cash received (SSP)">
        <TextInput inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9-]/g, '').slice(0, 10))} />
      </Field>
      <Field label="Note (optional)">
        <TextInput value={note} onChange={(e) => setNote(e.target.value.slice(0, 200))} placeholder="e.g. evening cash" />
      </Field>
      <Button onClick={save} disabled={receive.isPending}>
        {receive.isPending && <Spinner />} Save
      </Button>
      {receive.error && (
        <div className="sm:col-span-3">
          <Alert tone="error">{friendlyError(receive.error)}</Alert>
        </div>
      )}
    </div>
  );
}

function Terms({ row, onDone }: { row: CashRow; onDone: () => void }) {
  const [pct, setPct] = useState(String(row.commission_pct));
  const [limit, setLimit] = useState(row.credit_limit_ssp === null ? '' : String(row.credit_limit_ssp));
  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('set_seller_terms', {
        p_profile_id: row.seller_id,
        p_commission_pct: Number(pct || 0),
        p_credit_limit_ssp: limit.trim() === '' ? null : Number(limit),
      });
      if (error) throw new Error(friendlyError(error));
    },
    onSuccess: onDone,
  });
  return (
    <div className="mt-2 grid gap-2 rounded-xl bg-slate-50 p-3 sm:grid-cols-[10rem_12rem_auto] sm:items-end">
      <Field label="Commission %" hint="Of each cash sale">
        <TextInput inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value.replace(/[^0-9.]/g, '').slice(0, 5))} />
      </Field>
      <Field label="Credit limit (SSP)" hint="Most cash they may hold. Empty: no limit">
        <TextInput inputMode="numeric" value={limit} onChange={(e) => setLimit(e.target.value.replace(/\D/g, '').slice(0, 10))} />
      </Field>
      <Button onClick={() => save.mutate()} disabled={save.isPending}>
        {save.isPending && <Spinner />} Save
      </Button>
      {save.error && (
        <div className="sm:col-span-3">
          <Alert tone="error">{friendlyError(save.error)}</Alert>
        </div>
      )}
    </div>
  );
}

export function CashPage() {
  const { profile } = useAuth();
  const role = profile?.role;
  const sites = useSites();
  const queryClient = useQueryClient();
  const [date, setDate] = useState(todayInJuba);
  const [siteId, setSiteId] = useState('');
  const [open, setOpen] = useState<{ id: string; kind: 'receive' | 'terms' } | null>(null);

  const rows = useQuery({
    queryKey: ['cash-up', date, siteId],
    queryFn: async (): Promise<CashRow[]> => {
      const { data, error } = await supabase.rpc('cash_up', { p_date: date, p_site_id: siteId || null });
      if (error) throw new Error(friendlyError(error));
      return (data ?? []) as CashRow[];
    },
  });
  const done = () => {
    setOpen(null);
    void queryClient.invalidateQueries({ queryKey: ['cash-up'] });
  };

  const list = rows.data ?? [];
  const total = list.reduce(
    (t, r) => ({ cash: t.cash + r.cash_amount, toHand: t.toHand + r.to_hand_in, handed: t.handed + r.handed_in, held: t.held + r.held_now, momo: t.momo + r.momo_amount }),
    { cash: 0, toHand: 0, handed: 0, held: 0, momo: 0 },
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title={role === 'seller' ? 'My cash' : 'Cash-up'}
        subtitle={role === 'seller' ? 'Cash you sold, your commission, and what you still hold' : 'Each seller’s cash for the day: sold, commission, handed in, difference'}
      />
      <Card className="grid gap-3 sm:grid-cols-3">
        <Field label="Day">
          <TextInput type="date" value={date} max={todayInJuba()} onChange={(e) => setDate(e.target.value || todayInJuba())} />
        </Field>
        {role === 'admin' && (
          <Field label="Site">
            <Select value={siteId} onChange={(e) => setSiteId(e.target.value)}>
              <option value="">All sites</option>
              {(sites.data ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </Card>

      {role !== 'seller' && list.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-4">
          <Card>
            <p className="text-sm text-slate-500">Cash sales</p>
            <p className="text-xl font-bold">{ssp(total.cash)}</p>
          </Card>
          <Card>
            <p className="text-sm text-slate-500">To hand in (after commission)</p>
            <p className="text-xl font-bold">{ssp(total.toHand)}</p>
          </Card>
          <Card>
            <p className="text-sm text-slate-500">Handed in</p>
            <p className="text-xl font-bold">{ssp(total.handed)}</p>
          </Card>
          <Card>
            <p className="text-sm text-slate-500">Mobile money (to your number)</p>
            <p className="text-xl font-bold">{ssp(total.momo)}</p>
          </Card>
        </div>
      )}

      <Card>
        {rows.isLoading && <Spinner />}
        {rows.error && <Alert tone="error">{friendlyError(rows.error)}</Alert>}
        {!rows.isLoading && !list.length && <p className="text-slate-600">No sellers or cash on this day.</p>}
        <ul className="divide-y divide-slate-100">
          {list.map((r) => {
            const over = r.credit_limit_ssp !== null && r.held_now >= r.credit_limit_ssp;
            return (
              <li key={r.seller_id} className="py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-slate-900">
                      {r.name} <span className="text-sm font-normal text-slate-500">{r.site_name ?? 'All sites'}</span>
                    </p>
                    <p className="text-sm text-slate-700">
                      {r.cash_count} cash card{r.cash_count === 1 ? '' : 's'} · {ssp(r.cash_amount)}
                      {r.commission > 0 && ` · commission ${ssp(r.commission)} (${r.commission_pct}%)`}
                      {r.momo_count > 0 && ` · ${r.momo_count} mobile money (${ssp(r.momo_amount)})`}
                    </p>
                    <p className="text-sm text-slate-700">
                      To hand in {ssp(r.to_hand_in)} · handed in {ssp(r.handed_in)} ·{' '}
                      <b className={r.difference < 0 ? 'text-red-700' : r.difference > 0 ? 'text-green-700' : 'text-slate-800'}>
                        {r.difference === 0 ? 'balanced' : r.difference < 0 ? `short ${ssp(-r.difference)}` : `over ${ssp(r.difference)}`}
                      </b>
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-slate-500">Holds now</p>
                    <p className={`text-lg font-bold ${over ? 'text-red-700' : 'text-slate-900'}`}>{ssp(r.held_now)}</p>
                    {r.credit_limit_ssp !== null && <Badge color={over ? 'red' : 'gray'}>limit {ssp(r.credit_limit_ssp)}</Badge>}
                  </div>
                </div>
                {role !== 'seller' && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button variant="secondary" onClick={() => setOpen(open?.id === r.seller_id && open.kind === 'receive' ? null : { id: r.seller_id, kind: 'receive' })}>
                      Receive cash
                    </Button>
                    {role === 'admin' && (
                      <Button variant="ghost" onClick={() => setOpen(open?.id === r.seller_id && open.kind === 'terms' ? null : { id: r.seller_id, kind: 'terms' })}>
                        Commission & limit
                      </Button>
                    )}
                  </div>
                )}
                {open?.id === r.seller_id && open.kind === 'receive' && <ReceiveCash row={r} onDone={done} />}
                {open?.id === r.seller_id && open.kind === 'terms' && <Terms row={r} onDone={done} />}
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}
