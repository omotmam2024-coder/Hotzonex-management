import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../auth/AuthProvider';
import { Alert, Button, Field, ReportPrintStyle, ReportSection, Select, Spinner, TextInput, reportTd as td, reportTh as th, textButtonClass } from '../../components/ui';
import { PageHeader } from '../../components/PageHeader';
import { PeriodPicker } from '../../components/PeriodPicker';
import { useSites } from '../../hooks/queries';
import { useUsdRate } from '../../hooks/useBusinessSettings';
import { downloadText, toCsv } from '../../lib/csv';
import { friendlyError } from '../../lib/errors';
import { formatJubaStamp, formatNumber, formatSSP, formatUsd, jubaToday } from '../../lib/format';
import { currentPeriodName, periodLabel, shortDay, usePeriodParams, utc } from '../../lib/period';
import { categoryLabel, profitTone, useProfit, type Expense } from '../../lib/profit';
import { supabase } from '../../lib/supabase';
import { EXPENSE_CATEGORIES, expenseSchema, validate } from '../../lib/validation';

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
    <form onSubmit={submit} className="no-print rounded-2xl bg-white p-4 shadow-card ring-1 ring-brand-200 sm:p-5">
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
  const { profile, business } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const sites = useSites();
  const usdRate = useUsdRate();
  const queryClient = useQueryClient();
  const { tab, date, siteId, set } = usePeriodParams(isAdmin);
  const [editing, setEditing] = useState<Expense | 'new' | null>(null);

  const report = useProfit(tab, date, siteId);
  const businessName = business?.name ?? 'Hotzonex Cloud';

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
      [businessName, 'Profit report'],
      ['Period', label],
      ['Site', scope],
      ['Generated', formatJubaStamp()],
      [],
      ['Revenue (SSP)', r.summary.revenue],
      ['Agent commission (SSP)', r.summary.commission],
      ['Expenses (SSP)', r.summary.expenses],
      ['Profit (SSP)', r.summary.profit],
    ];
    if (r.days.length) {
      rows.push([], ['Day', 'Revenue (SSP)', 'Commission (SSP)', 'Expenses (SSP)', 'Profit (SSP)']);
      for (const d of r.days) rows.push([d.day, d.revenue, d.commission, d.expenses, d.profit]);
    }
    rows.push([], ['Day', 'Category', 'For', 'Note', 'Amount (SSP)', 'Recorded by']);
    for (const e of r.items) rows.push([e.spent_on, categoryLabel(e.category), e.site_name ?? 'Whole business', e.note, e.amount_ssp, e.created_by]);
    downloadText(`hotzonex-profit-${r.period}-${r.start}.csv`, toCsv(rows));
  }

  const stats: { label: string; value: string; sub?: string; tone?: string }[] = s
    ? [
        {
          label: 'Revenue',
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
          sub: [margin !== null ? `${margin}% of revenue` : '', formatUsd(s.profit, usdRate)].filter(Boolean).join(' · ') || undefined,
          tone: profitTone(s.profit),
        },
      ]
    : [];

  return (
    <div className="space-y-4">
      <ReportPrintStyle />
      <div className="hidden print:block">
        <div className="text-lg font-extrabold">{businessName} — profit report</div>
        <div className="text-sm">{label}</div>
        <div className="text-xs text-slate-600">Generated {formatJubaStamp()} (Juba time).</div>
      </div>

      <div className="no-print">
        <PageHeader
          title="Expenses & profit"
          subtitle="What you spend and what you keep"
          actions={
            <div className="no-print flex gap-2">
              <Button variant="secondary" className="px-3 text-sm" onClick={() => window.print()} disabled={!r}>
                Print
              </Button>
              <Button variant="secondary" className="px-3 text-sm" onClick={exportCsv} disabled={!r}>
                Download CSV
              </Button>
            </div>
          }
        />
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

      {r && (
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
      )}

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

      {r && (
        <>
          {remove.error && <Alert tone="error">{friendlyError(remove.error)}</Alert>}

          <ReportSection title="Expenses" aside={`${formatNumber(r.items.length)} · ${formatSSP(r.summary.expenses)}`}>
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
                        <button type="button" className={`${textButtonClass} text-brand-700`} onClick={() => setEditing(e)}>
                          Edit
                        </button>
                        <button
                          type="button"
                          className={`${textButtonClass} text-red-700`}
                          disabled={remove.isPending}
                          onClick={() =>
                            window.confirm(`Remove ${categoryLabel(e.category)} ${formatSSP(e.amount_ssp)} of ${shortDay.format(utc(e.spent_on))}?`) &&
                            remove.mutate(e.id)
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
          </ReportSection>

          <div className="grid gap-3 lg:grid-cols-2">
            {r.days.length > 0 && (
              <ReportSection title="Day by day" aside="days with nothing hidden">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr>
                      <th className={th}>Day</th>
                      <th className={`${th} text-right`}>Revenue</th>
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
              </ReportSection>
            )}

            {r.by_category.length > 0 && (
              <ReportSection title="Expenses by category">
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
              </ReportSection>
            )}
          </div>

          <p className="no-print text-xs text-slate-500">
            Profit = revenue − agent commission − expenses. Revenue is counted as on Reports (voided sales left out).
            {siteId ? ' With one site chosen, whole-business expenses are not included.' : ''}
          </p>
        </>
      )}
    </div>
  );
}
