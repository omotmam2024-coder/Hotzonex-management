import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../auth/AuthProvider';
import { PageHeader } from '../../components/PageHeader';
import { Alert, Badge, Button, Card, Field, Select, Spinner, TextInput } from '../../components/ui';
import { friendlyError } from '../../lib/errors';
import { formatSSP, jubaToday } from '../../lib/format';
import { useSites } from '../../hooks/queries';
import { fromJson, supabase } from '../../lib/supabase';
import { cashHandoverSchema, sellerTermsSchema, validate } from '../../lib/validation';
import { useT } from '../../i18n';

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

/** Checks the commission and credit limit typed in (validation.ts has no schema for seller terms). */
function ReceiveCash({ row, onDone }: { row: CashRow; onDone: () => void }) {
  const { t } = useT();
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
      <Field label={t('sales.cash.received')}>
        <TextInput inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9-]/g, '').slice(0, 10))} />
      </Field>
      <Field label={t('common.noteOptional')}>
        <TextInput value={note} onChange={(e) => setNote(e.target.value.slice(0, 200))} placeholder={t('sales.cash.notePlaceholder')} />
      </Field>
      <Button onClick={save} disabled={receive.isPending}>
        {receive.isPending && <Spinner />} {t('common.save')}
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
  const { t } = useT();
  const queryClient = useQueryClient();
  const [pct, setPct] = useState(String(row.commission_pct));
  const [limit, setLimit] = useState(row.credit_limit_ssp === null ? '' : String(row.credit_limit_ssp));
  const save = useMutation({
    mutationFn: async () => {
      const v = validate(sellerTermsSchema, { pct, limit });
      const { error } = await supabase.rpc('set_seller_terms', {
        p_profile_id: row.seller_id,
        p_commission_pct: v.pct,
        p_credit_limit_ssp: v.limit,
      });
      if (error) throw new Error(friendlyError(error));
    },
    onSuccess: () => {
      // Commission changes profit and the cash-up.
      void queryClient.invalidateQueries({ queryKey: ['profit'] });
      void queryClient.invalidateQueries({ queryKey: ['cash-up'] });
      onDone();
    },
  });
  // A double tap must not save twice.
  const inFlight = useRef(false);
  const submit = () => {
    if (inFlight.current) return;
    inFlight.current = true;
    save.mutate(undefined, { onSettled: () => (inFlight.current = false) });
  };
  return (
    <div className="mt-2 grid gap-2 rounded-xl bg-slate-50 p-3 sm:grid-cols-[10rem_12rem_auto] sm:items-end">
      <Field label={t('sales.cash.commissionPct')} hint={t('sales.cash.commissionHint')}>
        <TextInput inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value.replace(/[^0-9.]/g, '').slice(0, 5))} />
      </Field>
      <Field label={t('sales.cash.creditLimit')} hint={t('sales.cash.creditLimitHint')}>
        <TextInput inputMode="numeric" value={limit} onChange={(e) => setLimit(e.target.value.replace(/\D/g, '').slice(0, 10))} />
      </Field>
      <Button onClick={submit} disabled={save.isPending}>
        {save.isPending && <Spinner />} {t('common.save')}
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
  const { t } = useT();
  const { profile } = useAuth();
  const role = profile?.role;
  const sites = useSites();
  const queryClient = useQueryClient();
  const [date, setDate] = useState(jubaToday);
  const [siteId, setSiteId] = useState('');
  const [open, setOpen] = useState<{ id: string; kind: 'receive' | 'terms' } | null>(null);

  const rows = useQuery({
    queryKey: ['cash-up', date, siteId],
    queryFn: async (): Promise<CashRow[]> => {
      const { data, error } = await supabase.rpc('cash_up', { p_date: date, p_site_id: siteId || null });
      if (error) throw new Error(friendlyError(error));
      return fromJson<CashRow[] | null>(data) ?? [];
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
        title={role === 'seller' ? t('sales.cash.titleMine') : t('nav.cash')}
        subtitle={role === 'seller' ? t('sales.cash.subtitleMine') : t('sales.cash.subtitle')}
      />
      <Card className="grid gap-3 sm:grid-cols-3">
        <Field label={t('common.day')}>
          <TextInput type="date" value={date} max={jubaToday()} onChange={(e) => setDate(e.target.value || jubaToday())} />
        </Field>
        {role === 'admin' && (
          <Field label={t('common.site')}>
            <Select value={siteId} onChange={(e) => setSiteId(e.target.value)}>
              <option value="">{t('common.allSites')}</option>
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
            <p className="text-sm text-slate-500">{t('sales.cash.cashSales')}</p>
            <p className="text-xl font-bold tabular-nums sm:text-3xl">{formatSSP(total.cash)}</p>
          </Card>
          <Card>
            <p className="text-sm text-slate-500">{t('sales.cash.toHandAfter')}</p>
            <p className="text-xl font-bold tabular-nums sm:text-3xl">{formatSSP(total.toHand)}</p>
          </Card>
          <Card>
            <p className="text-sm text-slate-500">{t('sales.cash.handedIn')}</p>
            <p className="text-xl font-bold tabular-nums sm:text-3xl">{formatSSP(total.handed)}</p>
          </Card>
          <Card>
            <p className="text-sm text-slate-500">{t('sales.cash.momoTotal')}</p>
            <p className="text-xl font-bold tabular-nums sm:text-3xl">{formatSSP(total.momo)}</p>
          </Card>
        </div>
      )}

      <Card>
        {rows.isLoading && <Spinner />}
        {rows.error && <Alert tone="error">{friendlyError(rows.error)}</Alert>}
        {!rows.isLoading && !list.length && <p className="text-slate-600">{t('sales.cash.empty')}</p>}
        <ul className="divide-y divide-slate-100">
          {list.map((r) => {
            const over = r.credit_limit_ssp !== null && r.held_now >= r.credit_limit_ssp;
            return (
              <li key={r.seller_id} className="py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-slate-900">
                      {r.name} <span className="text-sm font-normal text-slate-500">{r.site_name ?? t('common.allSites')}</span>
                    </p>
                    <p className="text-sm text-slate-700">
                      {t(r.cash_count === 1 ? 'sales.cash.vouchersOne' : 'sales.cash.vouchersMany', { n: r.cash_count, amount: formatSSP(r.cash_amount) })}
                      {r.commission > 0 && t('sales.cash.commissionLine', { amount: formatSSP(r.commission), pct: r.commission_pct })}
                      {r.momo_count > 0 && t('sales.cash.momoLine', { n: r.momo_count, amount: formatSSP(r.momo_amount) })}
                    </p>
                    <p className="text-sm text-slate-700">
                      {t('sales.cash.handLine', { toHand: formatSSP(r.to_hand_in), handed: formatSSP(r.handed_in) })}{' '}
                      <b className={r.difference < 0 ? 'text-red-700' : r.difference > 0 ? 'text-green-700' : 'text-slate-800'}>
                        {r.difference === 0
                          ? t('sales.cash.balanced')
                          : r.difference < 0
                            ? t('sales.cash.short', { amount: formatSSP(-r.difference) })
                            : t('sales.cash.over', { amount: formatSSP(r.difference) })}
                      </b>
                    </p>
                  </div>
                  <div className="text-end">
                    <p className="text-xs text-slate-500">{t('sales.cash.holdsNow')}</p>
                    <p className={`text-lg font-bold ${over ? 'text-red-700' : 'text-slate-900'}`}>{formatSSP(r.held_now)}</p>
                    {r.credit_limit_ssp !== null && <Badge color={over ? 'red' : 'gray'}>{t('sales.cash.limit', { amount: formatSSP(r.credit_limit_ssp) })}</Badge>}
                  </div>
                </div>
                {role !== 'seller' && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button variant="secondary" onClick={() => setOpen(open?.id === r.seller_id && open.kind === 'receive' ? null : { id: r.seller_id, kind: 'receive' })}>
                      {t('sales.cash.receive')}
                    </Button>
                    {role === 'admin' && (
                      <Button variant="ghost" onClick={() => setOpen(open?.id === r.seller_id && open.kind === 'terms' ? null : { id: r.seller_id, kind: 'terms' })}>
                        {t('sales.cash.terms')}
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
