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
import { useT } from '../../i18n';

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
  const { t } = useT();
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
      <h2 className="mb-3 text-sm font-bold text-slate-900">{expense ? t('expenses.change') : t('expenses.add')}</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label={t('common.day')}>
          <TextInput type="date" value={spentOn} max={jubaToday()} onChange={(e) => setSpentOn(e.target.value)} />
        </Field>
        <Field label={t('expenses.category')}>
          <Select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">{t('common.choose')}</option>
            {EXPENSE_CATEGORIES.map((c) => (
              <option key={c.key} value={c.key}>
                {categoryLabel(c.key)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('common.amountSsp')}>
          <TextInput inputMode="numeric" value={amount} placeholder="0" onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, '').slice(0, 10))} />
        </Field>
        {isAdmin ? (
          <Field label={t('expenses.for')}>
            <Select value={siteId} onChange={(e) => setSiteId(e.target.value)}>
              <option value="">{t('expenses.wholeBusiness')}</option>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <Field label={t('common.noteOptional')}>
            <TextInput value={note} onChange={(e) => setNote(e.target.value.slice(0, 200))} placeholder={t('expenses.notePlaceholder')} />
          </Field>
        )}
        {isAdmin && (
          <div className="sm:col-span-2 lg:col-span-4">
            <Field label={t('common.noteOptional')}>
              <TextInput value={note} onChange={(e) => setNote(e.target.value.slice(0, 200))} placeholder={t('expenses.notePlaceholder')} />
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
          {save.isPending && <Spinner />} {expense ? t('expenses.saveChanges') : t('expenses.add')}
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
      </div>
    </form>
  );
}

export function ExpensesPage() {
  const { profile, business } = useAuth();
  const { t } = useT();
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
    const scope = siteId ? (sites.data?.find((x) => x.id === siteId)?.name ?? '') : t('common.allSites');
    const rows: (string | number | null)[][] = [
      [businessName, t('expenses.profitReport')],
      [t('expenses.period'), label],
      [t('common.site'), scope],
      [t('expenses.generated'), formatJubaStamp()],
      [],
      [t('expenses.revenueSsp'), r.summary.revenue],
      [t('expenses.agentCommissionSsp'), r.summary.commission],
      [t('expenses.expensesSsp'), r.summary.expenses],
      [t('expenses.profitSsp'), r.summary.profit],
    ];
    if (r.days.length) {
      rows.push([], [t('common.day'), t('expenses.revenueSsp'), t('expenses.commissionSsp'), t('expenses.expensesSsp'), t('expenses.profitSsp')]);
      for (const d of r.days) rows.push([d.day, d.revenue, d.commission, d.expenses, d.profit]);
    }
    rows.push([], [t('common.day'), t('expenses.category'), t('expenses.for'), t('common.note'), t('common.amountSsp'), t('expenses.recordedBy')]);
    for (const e of r.items) rows.push([e.spent_on, categoryLabel(e.category), e.site_name ?? t('expenses.wholeBusiness'), e.note, e.amount_ssp, e.created_by]);
    downloadText(`hotzonex-profit-${r.period}-${r.start}.csv`, toCsv(rows));
  }

  const stats: { label: string; value: string; sub?: string; tone?: string }[] = s
    ? [
        {
          label: t('common.revenue'),
          value: formatSSP(s.revenue),
          sub: formatUsd(s.revenue, usdRate) || undefined,
        },
        {
          label: t('expenses.agentCommission'),
          value: s.commission ? `− ${formatSSP(s.commission)}` : formatSSP(0),
        },
        {
          label: t('expenses.expenses'),
          value: s.expenses ? `− ${formatSSP(s.expenses)}` : formatSSP(0),
        },
        {
          label: t('expenses.profit'),
          value: formatSSP(s.profit),
          sub: [margin !== null ? t('expenses.pctOfRevenue', { n: margin }) : '', formatUsd(s.profit, usdRate)].filter(Boolean).join(' · ') || undefined,
          tone: profitTone(s.profit),
        },
      ]
    : [];

  return (
    <div className="space-y-4">
      <ReportPrintStyle />
      <div className="hidden print:block">
        <div className="text-lg font-extrabold">{t('expenses.printTitle', { business: businessName })}</div>
        <div className="text-sm">{label}</div>
        <div className="text-xs text-slate-600">{t('expenses.printGenerated', { stamp: formatJubaStamp() })}</div>
      </div>

      <div className="no-print">
        <PageHeader
          title={t('nav.expenses')}
          subtitle={t('expenses.subtitle')}
          actions={
            <div className="no-print flex gap-2">
              <Button variant="secondary" className="px-3 text-sm" onClick={() => window.print()} disabled={!r}>
                {t('common.print')}
              </Button>
              <Button variant="secondary" className="px-3 text-sm" onClick={exportCsv} disabled={!r}>
                {t('common.downloadCsv')}
              </Button>
            </div>
          }
        />
      </div>

      <PeriodPicker period={tab} date={date} onPeriod={(p) => set('tab', p)} onDate={(d) => set('date', d)}>
        {isAdmin && (sites.data?.length ?? 0) > 1 && (
          <Select aria-label={t('common.site')} className="!w-auto text-sm" value={siteId} onChange={(e) => set('site', e.target.value)}>
            <option value="">{t('common.allSites')}</option>
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
                <span>{t(`expenses.profitVs.${tab}`, { change: `${change > 0 ? '+' : ''}${change}` })}</span>
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
              <div key={x.label} className={i > 0 ? 'sm:border-s sm:border-slate-100 sm:ps-4' : ''}>
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
          {t('expenses.addButton')}
        </Button>
      )}

      {r && (
        <>
          {remove.error && <Alert tone="error">{friendlyError(remove.error)}</Alert>}

          <ReportSection title={t('expenses.expenses')} aside={`${formatNumber(r.items.length)} · ${formatSSP(r.summary.expenses)}`}>
            <table className="w-full text-start text-sm">
              <thead>
                <tr>
                  <th className={th}>{t('common.day')}</th>
                  <th className={th}>{t('expenses.what')}</th>
                  <th className={`${th} text-end`}>{t('common.amount')}</th>
                </tr>
              </thead>
              <tbody>
                {r.items.map((e) => (
                  <tr key={e.id} className="border-t border-slate-100 align-top">
                    <td className={`${td} whitespace-nowrap tabular-nums`}>{shortDay.format(utc(e.spent_on))}</td>
                    <td className={td}>
                      <div className="font-medium text-slate-900">{categoryLabel(e.category)}</div>
                      <div className="text-xs text-slate-500">{[e.note, e.site_name ?? (isAdmin ? t('expenses.wholeBusiness') : null)].filter(Boolean).join(' · ')}</div>
                      <div className="no-print -ms-2 flex">
                        <button type="button" className={`${textButtonClass} text-brand-700`} onClick={() => setEditing(e)}>
                          {t('common.edit')}
                        </button>
                        <button
                          type="button"
                          className={`${textButtonClass} text-red-700`}
                          disabled={remove.isPending}
                          onClick={() =>
                            window.confirm(t('expenses.confirmRemove', { category: categoryLabel(e.category), amount: formatSSP(e.amount_ssp), day: shortDay.format(utc(e.spent_on)) })) &&
                            remove.mutate(e.id)
                          }
                        >
                          {t('common.remove')}
                        </button>
                      </div>
                    </td>
                    <td className={`${td} whitespace-nowrap text-end font-semibold tabular-nums`}>{formatSSP(e.amount_ssp)}</td>
                  </tr>
                ))}
                {r.items.length === 0 && (
                  <tr>
                    <td colSpan={3} className="py-3 text-slate-500">
                      {t(`expenses.none.${tab}`)}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </ReportSection>

          <div className="grid gap-3 lg:grid-cols-2">
            {r.days.length > 0 && (
              <ReportSection title={t('expenses.dayByDay')} aside={t('expenses.nothingHidden')}>
                <table className="w-full text-start text-sm">
                  <thead>
                    <tr>
                      <th className={th}>{t('common.day')}</th>
                      <th className={`${th} text-end`}>{t('common.revenue')}</th>
                      <th className={`${th} text-end`}>{t('expenses.costs')}</th>
                      <th className={`${th} text-end`}>{t('expenses.profit')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeDays.map((d) => (
                      <tr key={d.day} className="border-t border-slate-100">
                        <td className={`${td} whitespace-nowrap tabular-nums`}>{shortDay.format(utc(d.day))}</td>
                        <td className={`${td} text-end tabular-nums`}>{formatNumber(d.revenue)}</td>
                        <td className={`${td} text-end tabular-nums text-slate-500`}>{formatNumber(d.commission + d.expenses)}</td>
                        <td className={`${td} text-end font-semibold tabular-nums ${profitTone(d.profit)}`}>{formatNumber(d.profit)}</td>
                      </tr>
                    ))}
                    {activeDays.length === 0 && (
                      <tr>
                        <td colSpan={4} className="py-3 text-slate-500">
                          {t('expenses.noSalesOrExpenses')}
                        </td>
                      </tr>
                    )}
                    <tr className="border-t border-slate-300 font-bold">
                      <td className={td}>{t('expenses.totalSsp')}</td>
                      <td className={`${td} text-end tabular-nums`}>{formatNumber(r.summary.revenue)}</td>
                      <td className={`${td} text-end tabular-nums`}>{formatNumber(r.summary.commission + r.summary.expenses)}</td>
                      <td className={`${td} text-end tabular-nums ${profitTone(r.summary.profit)}`}>{formatNumber(r.summary.profit)}</td>
                    </tr>
                  </tbody>
                </table>
              </ReportSection>
            )}

            {r.by_category.length > 0 && (
              <ReportSection title={t('expenses.byCategory')}>
                <table className="w-full text-start text-sm">
                  <tbody>
                    {r.by_category.map((c) => (
                      <tr key={c.category} className="border-t border-slate-100 first:border-t-0">
                        <td className={td}>{categoryLabel(c.category)}</td>
                        <td className={`${td} text-end font-semibold tabular-nums`}>{formatSSP(c.amount)}</td>
                        <td className={`${td} w-14 text-end tabular-nums text-slate-500`}>
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
            {t('expenses.footer')}
            {siteId ? t('expenses.footerSite') : ''}
          </p>
        </>
      )}
    </div>
  );
}
