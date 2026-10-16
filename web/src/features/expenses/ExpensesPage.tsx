import { useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../auth/AuthProvider';
import { Alert, Button, Field, Select, Spinner, TextInput } from '../../components/ui';
import { PeriodPicker } from '../../components/PeriodPicker';
import { useSites } from '../../hooks/queries';
import { useUsdRate } from '../../hooks/useBusinessSettings';
import { downloadText, toCsv } from '../../lib/csv';
import { friendlyError } from '../../lib/errors';
import { formatNumber, formatSSP, formatUsd, jubaToday } from '../../lib/format';
import { currentPeriodName, parsePeriod, periodLabel, shortDay, utc, type Period } from '../../lib/period';
import { fromJson, supabase } from '../../lib/supabase';
import { EXPENSE_CATEGORIES, expenseSchema, validate } from '../../lib/validation';

interface Money {
  revenue: number;
  commission: number;
  expenses: number;
  profit: number;
}

interface Expense {
  id: string;
  spent_on: string;
  category: string;
  amount_ssp: number;
  note: string | null;
  site_id: string | null;
  site_name: string | null;
  created_by: string | null;
}

export interface ProfitReport {
  period: Period;
  start: string;
  end: string;
  site_id: string | null;
  summary: Money;
  previous: Omit<Money, 'commission'>;
  days: (Money & { day: string })[];
  by_category: { category: string; amount: number }[];
  items: Expense[];
}

const MIGRATION_MISSING = 'Expenses need the database update of 16 October (migration 20261016210000_expenses.sql).';

export const categoryLabel = (key: string) => EXPENSE_CATEGORIES.find((c) => c.key === key)?.label ?? key;

/** profit_report for a period; null when the expenses migration is not applied yet. */
export async function fetchProfit(period: Period, date: string, siteId: string): Promise<ProfitReport | null> {
  const { data, error } = await supabase.rpc('profit_report', {
    p_period: period,
    p_date: date,
    p_site_id: siteId || null,
  });
  if (error?.code === 'PGRST202') return null;
  if (error) throw new Error(friendlyError(error));
  return fromJson<ProfitReport>(data);
}

const th = 'py-2 pr-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500 last:pr-0';
const td = 'py-1.5 pr-3 last:pr-0';
const profitTone = (n: number) => (n > 0 ? 'text-green-700' : n < 0 ? 'text-red-700' : 'text-slate-900');

function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="report-section rounded-2xl bg-white shadow-card ring-1 ring-slate-200/70">
      <div className="flex items-baseline justify-between gap-2 border-b border-slate-100 px-4 py-2.5">
        <h2 className="text-sm font-bold text-slate-900">{title}</h2>
        {aside && <span className="text-xs text-slate-500">{aside}</span>}
      </div>
      <div className="overflow-x-auto px-4 pb-2">{children}</div>
    </section>
  );
}

function ExpenseForm({
  expense,
  isAdmin,
  mySiteId,
  defaultSiteId,
  sites,
  onDone,
  onCancel,
}: {
  expense: Expense | null;
  isAdmin: boolean;
  mySiteId: string | null;
  defaultSiteId: string;
  sites: { id: string; name: string }[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const [spentOn, setSpentOn] = useState(expense?.spent_on ?? jubaToday());
  const [category, setCategory] = useState(expense?.category ?? '');
  const [amount, setAmount] = useState(expense ? String(expense.amount_ssp) : '');
  const [note, setNote] = useState(expense?.note ?? '');
  const [siteId, setSiteId] = useState(expense ? (expense.site_id ?? '') : isAdmin ? defaultSiteId : (mySiteId ?? ''));
  const save = useMutation({
    mutationFn: async () => {
      const v = validate(expenseSchema, {
        spent_on: spentOn,
        category,
        amount,
        note,
        site_id: siteId,
      });
      const { error } = await supabase.rpc('save_expense', {
        p_id: expense?.id ?? null,
        p_spent_on: v.spent_on,
        p_category: v.category,
        p_amount_ssp: v.amount,
        p_note: v.note || null,
        p_site_id: v.site_id || null,
      });
      if (error?.code === 'PGRST202') throw new Error(MIGRATION_MISSING);
      if (error) throw new Error(friendlyError(error));
    },
    onSuccess: onDone,
  });
  // A double tap must not record the expense twice.
  const inFlight = useRef(false);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    save.mutate(undefined, { onSettled: () => (inFlight.current = false) });
  };

  return (
    <form onSubmit={submit} className="no-print rounded-2xl bg-white p-4 shadow-card ring-1 ring-brand-200">
      <h2 className="mb-3 text-sm font-bold text-slate-900">{expense ? 'Change expense' : 'Add expense'}</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Day">
          <TextInput type="date" value={spentOn} max={jubaToday()} onChange={(e) => setSpentOn(e.target.value)} />
        </Field>
        <Field label="Category">
          <Select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">Choose…</option>
            {EXPENSE_CATEGORIES.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Amount (SSP)">
          <TextInput inputMode="numeric" value={amount} placeholder="0" onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, '').slice(0, 10))} />
        </Field>
        {isAdmin ? (
          <Field label="For">
            <Select value={siteId} onChange={(e) => setSiteId(e.target.value)}>
              <option value="">Whole business</option>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <Field label="Note (optional)">
            <TextInput value={note} onChange={(e) => setNote(e.target.value.slice(0, 200))} placeholder="e.g. Starlink October" />
          </Field>
        )}
        {isAdmin && (
          <div className="sm:col-span-2 lg:col-span-4">
            <Field label="Note (optional)">
              <TextInput value={note} onChange={(e) => setNote(e.target.value.slice(0, 200))} placeholder="e.g. Starlink October" />
            </Field>
          </div>
        )}
      </div>
      {save.error && (
        <div className="mt-3">
          <Alert tone="error">{friendlyError(save.error)}</Alert>
        </div>
      )}
      <div className="mt-3 flex gap-2">
        <Button type="submit" disabled={save.isPending}>
          {save.isPending && <Spinner />} {expense ? 'Save changes' : 'Add expense'}
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function ExpensesPage() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const sites = useSites();
  const usdRate = useUsdRate();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const tab = parsePeriod(params.get('tab'));
  const date = /^\d{4}-\d{2}-\d{2}$/.test(params.get('date') ?? '') ? (params.get('date') as string) : jubaToday();
  const siteId = isAdmin ? (params.get('site') ?? '') : '';
  const [editing, setEditing] = useState<Expense | 'new' | null>(null);

  function set(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  }

  const report = useQuery({
    queryKey: ['profit', tab, date, siteId],
    placeholderData: keepPreviousData,
    queryFn: () => fetchProfit(tab, date, siteId),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc('remove_expense', { p_id: id });
      if (error) throw new Error(friendlyError(error));
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['profit'] }),
  });

  const r = report.data;
  const label = r ? periodLabel(tab, r.start, r.end) : '';
  const isCurrent = r ? jubaToday() >= r.start && jubaToday() <= r.end : true;
  const s = r?.summary;
  const margin = s && s.revenue > 0 ? Math.round((s.profit / s.revenue) * 100) : null;
  const prevProfit = r?.previous.profit ?? 0;
  const change = r && prevProfit !== 0 ? Math.round(((r.summary.profit - prevProfit) / Math.abs(prevProfit)) * 100) : null;
  const activeDays = (r?.days ?? []).filter((d) => d.revenue || d.expenses || d.commission);

  function exportCsv() {
    if (!r) return;
    const scope = siteId ? (sites.data?.find((x) => x.id === siteId)?.name ?? '') : 'All sites';
    const rows: (string | number | null)[][] = [
      ['Hotzonex WiFi', 'Profit report'],
      ['Period', label],
      ['Site', scope],
      [],
      ['Sales (SSP)', r.summary.revenue],
      ['Agent commission (SSP)', r.summary.commission],
      ['Expenses (SSP)', r.summary.expenses],
      ['Profit (SSP)', r.summary.profit],
    ];
    if (r.days.length) {
      rows.push([], ['Day', 'Sales (SSP)', 'Commission (SSP)', 'Expenses (SSP)', 'Profit (SSP)']);
      for (const d of r.days) rows.push([d.day, d.revenue, d.commission, d.expenses, d.profit]);
    }
    rows.push([], ['Day', 'Category', 'For', 'Note', 'Amount (SSP)', 'Recorded by']);
    for (const e of r.items) rows.push([e.spent_on, categoryLabel(e.category), e.site_name ?? 'Whole business', e.note, e.amount_ssp, e.created_by]);
    downloadText(`hotzonex-profit-${r.period}-${r.start}.csv`, toCsv(rows));
  }

  const stats: { label: string; value: string; sub?: string; tone?: string }[] = s
    ? [
        {
          label: 'Sales',
          value: formatSSP(s.revenue),
          sub: formatUsd(s.revenue, usdRate) || undefined,
        },
        {
          label: 'Agent commission',
          value: s.commission ? `− ${formatSSP(s.commission)}` : formatSSP(0),
        },
        {
          label: 'Expenses',
          value: s.expenses ? `− ${formatSSP(s.expenses)}` : formatSSP(0),
        },
        {
          label: 'Profit',
          value: formatSSP(s.profit),
          sub: [margin !== null ? `${margin}% of sales` : '', formatUsd(s.profit, usdRate)].filter(Boolean).join(' · ') || undefined,
          tone: profitTone(s.profit),
        },
      ]
    : [];

  return (
    <div className="space-y-3">
      <style>{`@page { size: A4 portrait; margin: 12mm; } @media print { .report-section { break-inside: avoid; box-shadow: none; border: 1px solid #e2e8f0; } }`}</style>
      <div className="hidden print:block">
        <div className="text-lg font-extrabold">Hotzonex WiFi — profit report</div>
        <div className="text-sm">{label}</div>
      </div>

      <div className="no-print flex items-center justify-between gap-2">
        <h1 className="text-xl font-bold text-slate-900">Expenses &amp; profit</h1>
        <div className="flex gap-2">
          <Button variant="secondary" className="px-3 text-sm" onClick={() => window.print()} disabled={!r}>
            Print
          </Button>
          <Button variant="secondary" className="px-3 text-sm" onClick={exportCsv} disabled={!r}>
            CSV
          </Button>
        </div>
      </div>

      <PeriodPicker period={tab} date={date} onPeriod={(p) => set('tab', p)} onDate={(d) => set('date', d)}>
        {isAdmin && (sites.data?.length ?? 0) > 1 && (
          <Select aria-label="Site" className="!w-auto text-sm" value={siteId} onChange={(e) => set('site', e.target.value)}>
            <option value="">All sites</option>
            {(sites.data ?? []).map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </Select>
        )}
        {report.isFetching && <Spinner className="h-4 w-4 text-brand-600" />}
      </PeriodPicker>

      {report.error && <Alert tone="error">{friendlyError(report.error)}</Alert>}
      {report.isLoading && <Spinner className="h-8 w-8 text-brand-600" />}
      {report.data === null && <Alert tone="info">{MIGRATION_MISSING}</Alert>}

      {r && (
        <>
          <section className="report-section rounded-2xl bg-white p-4 shadow-card ring-1 ring-slate-200/70">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <div className="text-sm font-semibold text-slate-900">{label}</div>
              <div className="flex items-center gap-3 text-xs text-slate-500">
                {change !== null && (
                  <span>
                    Profit {change > 0 ? '+' : ''}
                    {change}% vs previous {tab}
                  </span>
                )}
                {!isCurrent && (
                  <button type="button" onClick={() => set('date', '')} className="no-print min-h-11 font-semibold text-brand-700 hover:underline">
                    {currentPeriodName(tab)}
                  </button>
                )}
              </div>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
              {stats.map((x, i) => (
                <div key={x.label} className={i > 0 ? 'sm:border-l sm:border-slate-100 sm:pl-4' : ''}>
                  <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{x.label}</dt>
                  <dd className={`whitespace-nowrap text-base font-bold tabular-nums sm:text-xl ${x.tone ?? 'text-slate-900'}`}>{x.value}</dd>
                  {x.sub && <dd className="text-xs text-slate-500">{x.sub}</dd>}
                </div>
              ))}
            </dl>
          </section>

          {editing ? (
            <ExpenseForm
              key={editing === 'new' ? 'new' : editing.id}
              expense={editing === 'new' ? null : editing}
              isAdmin={isAdmin}
              mySiteId={profile?.site_id ?? null}
              defaultSiteId={siteId}
              sites={sites.data ?? []}
              onCancel={() => setEditing(null)}
              onDone={() => {
                setEditing(null);
                void queryClient.invalidateQueries({ queryKey: ['profit'] });
              }}
            />
          ) : (
            <Button className="no-print w-full sm:w-auto" onClick={() => setEditing('new')}>
              + Add expense
            </Button>
          )}

          {remove.error && <Alert tone="error">{friendlyError(remove.error)}</Alert>}

          <Section title="Expenses" aside={`${formatNumber(r.items.length)} · ${formatSSP(r.summary.expenses)}`}>
            <table className="w-full text-left text-sm">
              <thead>
                <tr>
                  <th className={th}>Day</th>
                  <th className={th}>What</th>
                  <th className={`${th} text-right`}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {r.items.map((e) => (
                  <tr key={e.id} className="border-t border-slate-100 align-top">
                    <td className={`${td} whitespace-nowrap tabular-nums`}>{shortDay.format(utc(e.spent_on))}</td>
                    <td className={td}>
                      <div className="font-medium text-slate-900">{categoryLabel(e.category)}</div>
                      <div className="text-xs text-slate-500">{[e.note, e.site_name ?? (isAdmin ? 'Whole business' : null)].filter(Boolean).join(' · ')}</div>
                      <div className="no-print -ml-2 flex">
                        <button type="button" className="min-h-11 px-2 text-xs font-semibold text-brand-700 hover:underline" onClick={() => setEditing(e)}>
                          Edit
                        </button>
                        <button
                          type="button"
                          className="min-h-11 px-2 text-xs font-semibold text-red-700 hover:underline disabled:opacity-50"
                          disabled={remove.isPending}
                          onClick={() =>
                            window.confirm(`Remove ${categoryLabel(e.category)} ${formatSSP(e.amount_ssp)} of ${e.spent_on}?`) && remove.mutate(e.id)
                          }
                        >
                          Remove
                        </button>
                      </div>
                    </td>
                    <td className={`${td} whitespace-nowrap text-right font-semibold tabular-nums`}>{formatSSP(e.amount_ssp)}</td>
                  </tr>
                ))}
                {r.items.length === 0 && (
                  <tr>
                    <td colSpan={3} className="py-3 text-slate-500">
                      No expenses recorded for this {tab}.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </Section>

          <div className="grid gap-3 lg:grid-cols-2">
            {r.days.length > 0 && (
              <Section title="Day by day" aside="days with nothing hidden">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr>
                      <th className={th}>Day</th>
                      <th className={`${th} text-right`}>Sales</th>
                      <th className={`${th} text-right`}>Costs</th>
                      <th className={`${th} text-right`}>Profit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeDays.map((d) => (
                      <tr key={d.day} className="border-t border-slate-100">
                        <td className={`${td} whitespace-nowrap tabular-nums`}>{shortDay.format(utc(d.day))}</td>
                        <td className={`${td} text-right tabular-nums`}>{formatNumber(d.revenue)}</td>
                        <td className={`${td} text-right tabular-nums text-slate-500`}>{formatNumber(d.commission + d.expenses)}</td>
                        <td className={`${td} text-right font-semibold tabular-nums ${profitTone(d.profit)}`}>{formatNumber(d.profit)}</td>
                      </tr>
                    ))}
                    {activeDays.length === 0 && (
                      <tr>
                        <td colSpan={4} className="py-3 text-slate-500">
                          No sales or expenses.
                        </td>
                      </tr>
                    )}
                    <tr className="border-t border-slate-300 font-bold">
                      <td className={td}>Total SSP</td>
                      <td className={`${td} text-right tabular-nums`}>{formatNumber(r.summary.revenue)}</td>
                      <td className={`${td} text-right tabular-nums`}>{formatNumber(r.summary.commission + r.summary.expenses)}</td>
                      <td className={`${td} text-right tabular-nums ${profitTone(r.summary.profit)}`}>{formatNumber(r.summary.profit)}</td>
                    </tr>
                  </tbody>
                </table>
              </Section>
            )}

            {r.by_category.length > 0 && (
              <Section title="Expenses by category">
                <table className="w-full text-left text-sm">
                  <tbody>
                    {r.by_category.map((c) => (
                      <tr key={c.category} className="border-t border-slate-100 first:border-t-0">
                        <td className={td}>{categoryLabel(c.category)}</td>
                        <td className={`${td} text-right font-semibold tabular-nums`}>{formatSSP(c.amount)}</td>
                        <td className={`${td} w-14 text-right tabular-nums text-slate-500`}>
                          {r.summary.expenses ? Math.round((c.amount / r.summary.expenses) * 100) : 0}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Section>
            )}
          </div>

          <p className="no-print text-xs text-slate-500">
            Profit = sales − agent commission − expenses. Sales are counted as on Reports (voided sales left out).
            {siteId ? ' With one site chosen, whole-business expenses are not included.' : ''}
          </p>
        </>
      )}
    </div>
  );
}
