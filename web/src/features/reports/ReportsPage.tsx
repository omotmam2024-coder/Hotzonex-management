import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useAuth } from '../../auth/AuthProvider';
import { Alert, Button, Card, Field, ReportPrintStyle, ReportSection, Select, Spinner, reportTd as td, reportTh as th } from '../../components/ui';
import { PageHeader } from '../../components/PageHeader';
import { downloadText, toCsv } from '../../lib/csv';
import { friendlyError } from '../../lib/errors';
import { useUsdRate } from '../../hooks/useBusinessSettings';
import { formatJubaStamp, formatJubaTime, formatNumber, formatSSP, formatUsd, jubaToday } from '../../lib/format';
import { profileLabel } from '../../lib/mikroticket';
import { usePlans, useSites } from '../../hooks/queries';
import { fromJson, supabase } from '../../lib/supabase';
import { PERIODS, currentPeriodName, periodLabel, shortDay, usePeriodParams, utc, type Period } from '../../lib/period';
import { profitTone, useProfit } from '../../lib/profit';
import { PeriodPicker } from '../../components/PeriodPicker';
import { useT } from '../../i18n';

interface Row {
  sold: number;
  revenue: number;
}

interface Report {
  period: Period;
  start: string;
  end: string;
  previous_start: string;
  previous_end: string;
  site_id: string | null;
  summary: Row & { average: number; previous_sold: number; previous_revenue: number; change_pct: number | null };
  by_plan: (Row & { plan_id: string; name: string; color: string; share_pct: number })[];
  by_seller: (Row & { seller_id: string | null; name: string })[];
  by_site: (Row & { site_id: string; name: string })[];
  breakdown: (Row & { hour?: number; day?: string; week_start?: string })[];
  voucher_status: { created: number; unused: number; sold: number; active: number; expired: number; disabled: number };
  router_logins: { router_id: string; username: string; plan: string | null; price_ssp: number | null; first_login_at: string | null; last_seen_at: string | null; new: boolean }[];
}

function hourLabel(h: number): string {
  return `${String(h).padStart(2, '0')}:00–${String(h).padStart(2, '0')}:59`;
}

/** A plain name / sold / revenue table with a total line. */
function SalesTable({ head, rows, total }: { head: string; rows: { key: string; name: ReactNode; sold: number; revenue: number; extra?: string }[]; total?: Row }) {
  const { t } = useT();
  const hasExtra = rows.some((x) => x.extra !== undefined);
  return (
    <table className="w-full text-start text-sm">
      <thead>
        <tr>
          <th className={th}>{head}</th>
          <th className={`${th} text-end`}>{t('common.sold')}</th>
          <th className={`${th} text-end`}>{t('common.revenue')}</th>
          {hasExtra && <th className={`${th} text-end`}>{t('common.share_pct')}</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((x) => (
          <tr key={x.key} className="border-t border-slate-100">
            <td className={td}>{x.name}</td>
            <td className={`${td} text-end tabular-nums`}>{formatNumber(x.sold)}</td>
            <td className={`${td} text-end font-semibold tabular-nums`}>{formatSSP(x.revenue)}</td>
            {hasExtra && <td className={`${td} text-end tabular-nums text-slate-500`}>{x.extra}</td>}
          </tr>
        ))}
        {rows.length === 0 && (
          <tr>
            <td colSpan={hasExtra ? 4 : 3} className="py-3 text-slate-500">
              {t('reports.noSales')}
            </td>
          </tr>
        )}
        {total && rows.length > 1 && (
          <tr className="border-t border-slate-300 font-bold">
            <td className={td}>{t('common.total')}</td>
            <td className={`${td} text-end tabular-nums`}>{formatNumber(total.sold)}</td>
            <td className={`${td} text-end tabular-nums`}>{formatSSP(total.revenue)}</td>
            {hasExtra && <td className={td} />}
          </tr>
        )}
      </tbody>
    </table>
  );
}

export function ReportsPage() {
  const { profile, siteName: mySite, business } = useAuth();
  const { t, dir } = useT();
  const isAdmin = profile?.role === 'admin';
  const sites = useSites();
  const usdRate = useUsdRate();
  const plans = usePlans();
  const { params, tab, date, siteId, set } = usePeriodParams(isAdmin);
  const planId = params.get('plan') ?? '';
  const sellerId = params.get('seller') ?? '';
  const [showFilters, setShowFilters] = useState(false);
  const [showMore, setShowMore] = useState(false);

  const staff = useQuery({
    queryKey: ['staff-options'],
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('id, full_name, site_id').order('full_name');
      if (error) throw new Error(error.message);
      return (data ?? []) as { id: string; full_name: string; site_id: string | null }[];
    },
  });

  const report = useQuery({
    queryKey: ['report', tab, date, siteId, planId, sellerId],
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<Report> => {
      const { data, error } = await supabase.rpc('report_period', {
        p_period: tab,
        p_date: date,
        p_site_id: siteId || null,
        p_plan_id: planId || null,
        p_seller_id: sellerId || null,
      });
      if (error) throw new Error(friendlyError(error));
      return fromJson<Report>(data);
    },
  });

  // Profit needs the whole period's sales, so it is shown only without a plan or seller filter.
  const showProfit = !planId && !sellerId;
  const profit = useProfit(tab, date, siteId, showProfit);
  const businessName = business?.name ?? 'Hotzonex Cloud';

  const r = report.data;
  const scope = isAdmin ? (siteId ? (sites.data?.find((s) => s.id === siteId)?.name ?? '') : t('common.allSites')) : (mySite ?? '');
  const planName = planId ? (plans.data?.find((p) => p.id === planId)?.name ?? '') : t('common.allPlans');
  const sellerName = sellerId ? (staff.data?.find((s) => s.id === sellerId)?.full_name ?? '') : t('reports.allCashiers');
  const label = r ? periodLabel(tab, r.start, r.end) : '';
  const noun = PERIODS.find((p) => p.key === tab)?.noun ?? '';
  const reportTitle = t('reports.salesReport', { noun });
  const isCurrent = r ? jubaToday() >= r.start && jubaToday() <= r.end : true;

  // Monthly breakdown: insert a subtotal after each Sunday and at the end of the month.
  const breakdownRows = useMemo(() => {
    if (!r) return [];
    type Line = { kind: 'row'; label: string; sold: number; revenue: number } | { kind: 'subtotal'; label: string; sold: number; revenue: number };
    const out: Line[] = [];
    if (r.period === 'day') {
      for (const b of r.breakdown) out.push({ kind: 'row', label: hourLabel(b.hour ?? 0), sold: b.sold, revenue: b.revenue });
      return out;
    }
    let wk = { sold: 0, revenue: 0, from: '' };
    r.breakdown.forEach((b, i) => {
      const day = b.day ?? '';
      out.push({ kind: 'row', label: shortDay.format(utc(day)), sold: b.sold, revenue: b.revenue });
      if (r.period === 'month') {
        if (!wk.from) wk.from = day;
        wk.sold += b.sold;
        wk.revenue += b.revenue;
        const isSunday = utc(day).getUTCDay() === 0;
        if (isSunday || i === r.breakdown.length - 1) {
          out.push({ kind: 'subtotal', label: t('reports.weekRange', { from: shortDay.format(utc(wk.from)), to: shortDay.format(utc(day)) }), sold: wk.sold, revenue: wk.revenue });
          wk = { sold: 0, revenue: 0, from: '' };
        }
      }
    });
    return out;
  }, [r, t]);

  function exportCsv() {
    if (!r) return;
    const s = r.summary;
    const rows: (string | number | null)[][] = [
      [businessName, reportTitle],
      [t('reports.period'), label],
      [t('common.site'), scope],
      [t('common.plan'), planName],
      [t('role.seller'), sellerName],
      [t('reports.generated'), formatJubaStamp()],
      [t('common.note'), t('reports.csvNote')],
      [],
      [t('reports.summary')],
      [t('reports.vouchersSold'), s.sold],
      [t('reports.revenueSsp'), s.revenue],
      [t('reports.avgSaleSsp'), s.average],
      [t('reports.prevRevenueSsp'), s.previous_revenue],
      [t('reports.changePct'), s.change_pct],
      [],
      [t('reports.byPlan')],
      [t('common.plan'), t('reports.vouchersSold'), t('reports.revenueSsp'), t('reports.shareOfRevenue')],
      ...r.by_plan.map((p) => [p.name, p.sold, p.revenue, p.share_pct]),
      [],
      [t('reports.bySeller')],
      [t('role.seller'), t('reports.vouchersSold'), t('reports.revenueSsp')],
      ...r.by_seller.map((p) => [p.name, p.sold, p.revenue]),
    ];
    if (!r.site_id) rows.push([], [t('reports.bySite')], [t('common.site'), t('reports.vouchersSold'), t('reports.revenueSsp')], ...r.by_site.map((p) => [p.name, p.sold, p.revenue]));
    rows.push([], [r.period === 'day' ? t('reports.perHour') : t('reports.perDay')], [r.period === 'day' ? t('reports.hour') : t('common.day'), t('reports.vouchersSold'), t('reports.revenueSsp')]);
    for (const b of breakdownRows) rows.push([b.kind === 'subtotal' ? t('reports.subtotal', { label: b.label }) : b.label, b.sold, b.revenue]);
    const v = r.voucher_status;
    rows.push(
      [],
      [t('reports.createdByStatus')],
      [t('reports.created'), t('voucher.unused'), t('voucher.sold'), t('voucher.active'), t('voucher.expired'), t('voucher.disabled')],
      [v.created, v.unused, v.sold, v.active, v.expired, v.disabled],
    );
    downloadText(`hotzonex-${r.period === 'day' ? 'daily' : r.period === 'week' ? 'weekly' : 'monthly'}-report-${r.start}.csv`, toCsv(rows));
  }

  const change = r?.summary.change_pct;
  const filterCount = (siteId ? 1 : 0) + (planId ? 1 : 0) + (sellerId ? 1 : 0);
  const shownBreakdown = breakdownRows.filter((b) => b.kind === 'subtotal' || b.sold > 0);
  const filtersText = [isAdmin || scope ? scope : '', planId ? planName : '', sellerId ? sellerName : ''].filter(Boolean).join(' · ');

  const stats: { label: string; value: string; sub?: ReactNode }[] = r
    ? [
        { label: t('common.revenue'), value: formatSSP(r.summary.revenue), sub: usdRate ? formatUsd(r.summary.revenue, usdRate) : undefined },
        { label: t('reports.vouchersSold'), value: formatNumber(r.summary.sold) },
        { label: t('reports.averageSale'), value: formatSSP(r.summary.average) },
        {
          label: t(`reports.vsPrev.${tab}`),
          value: change === null || change === undefined ? '—' : `${change > 0 ? '+' : ''}${change}%`,
          sub: <>{t('reports.was', { amount: formatSSP(r.summary.previous_revenue) })}</>,
        },
      ]
    : [];

  return (
    <div className="space-y-4">
      <ReportPrintStyle />

      {/* Print header */}
      <div className="hidden print:block">
        <div className="text-lg font-extrabold">
          {businessName} — {reportTitle}
        </div>
        <div className="text-sm">
          {label} · {scope} · {planName} · {sellerName}
        </div>
        <div className="text-xs text-slate-600">{t('reports.printGenerated', { stamp: formatJubaStamp() })}</div>
      </div>

      <div className="no-print">
        <PageHeader
          title={t('nav.reports')}
          subtitle={t('reports.subtitle')}
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
        <Button
          variant="secondary"
          aria-expanded={showFilters}
          onClick={() => setShowFilters((v) => !v)}
          className={`px-3 text-sm ${filterCount ? '!bg-brand-50 !text-brand-800 !ring-brand-200' : ''}`}
        >
          {t('common.filters')}{filterCount ? ` (${filterCount})` : ''}
        </Button>
        {report.isFetching && <Spinner className="h-4 w-4 text-brand-600" />}
      </PeriodPicker>

      {showFilters && (
        <Card className="no-print !p-3">
          <div className="grid gap-3 sm:grid-cols-3">
            {isAdmin && (
              <Field label={t('common.site')}>
                <Select value={siteId} onChange={(e) => set('site', e.target.value)}>
                  <option value="">{t('common.allSites')}</option>
                  {(sites.data ?? []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <Field label={t('common.plan')}>
              <Select value={planId} onChange={(e) => set('plan', e.target.value)}>
                <option value="">{t('common.allPlans')}</option>
                {(plans.data ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('role.seller')}>
              <Select value={sellerId} onChange={(e) => set('seller', e.target.value)}>
                <option value="">{t('common.everyone')}</option>
                {(staff.data ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.full_name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </Card>
      )}

      {report.error && <Alert tone="error">{friendlyError(report.error)}</Alert>}
      {report.isLoading && <Spinner className="h-8 w-8 text-brand-600" />}

      {r && (
        <>
          <section className="report-section rounded-2xl bg-white p-4 shadow-card ring-1 ring-slate-200/70">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <div className="text-sm font-semibold text-slate-900">{label}</div>
              <div className="flex items-center gap-3 text-xs text-slate-500">
                {filtersText && <span>{filtersText}</span>}
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
                  <dd
                    className={`text-xl font-bold tabular-nums ${
                      i === 3 && typeof change === 'number' ? (change > 0 ? 'text-green-700' : change < 0 ? 'text-red-700' : 'text-slate-900') : 'text-slate-900'
                    }`}
                  >
                    {x.value}
                  </dd>
                  {x.sub && <dd className="text-xs text-slate-500">{x.sub}</dd>}
                </div>
              ))}
            </dl>
            {showProfit && profit.error && !profit.data && (
              <p className="mt-3 border-t border-slate-100 pt-3 text-xs text-slate-500">{t('reports.profitFailed', { error: friendlyError(profit.error) })}</p>
            )}
            {showProfit && profit.data && (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-slate-100 pt-3 text-sm">
                <span className="text-slate-600">
                  {t('reports.commission')} <span className="font-semibold tabular-nums text-slate-900">{formatSSP(profit.data.summary.commission)}</span>
                  {' · '}{t('reports.expenses')} <span className="font-semibold tabular-nums text-slate-900">{formatSSP(profit.data.summary.expenses)}</span>
                  {' · '}{t('reports.profit')}{' '}
                  <span className={`font-bold tabular-nums ${profitTone(profit.data.summary.profit)}`}>{formatSSP(profit.data.summary.profit)}</span>
                </span>
                <Link to={`/expenses?${params.toString()}`} className="no-print inline-flex min-h-11 items-center font-semibold text-brand-700 hover:underline">
                  {t('nav.expenses')} {dir === 'rtl' ? '‹' : '›'}
                </Link>
              </div>
            )}
          </section>

          <div className="grid gap-3 lg:grid-cols-2">
            <ReportSection title={t('reports.byPlan')}>
              <SalesTable
                head={t('common.plan')}
                total={r.summary}
                rows={r.by_plan.map((p) => ({
                  key: p.plan_id,
                  sold: p.sold,
                  revenue: p.revenue,
                  extra: `${p.share_pct}%`,
                  name: (
                    <span className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: p.color, printColorAdjust: 'exact', WebkitPrintColorAdjust: 'exact' }} />
                      {p.name}
                    </span>
                  ),
                }))}
              />
            </ReportSection>
            <ReportSection title={t('reports.byCashier')}>
              <SalesTable head={t('reports.name')} total={r.summary} rows={r.by_seller.map((p) => ({ key: p.seller_id ?? p.name, name: p.name, sold: p.sold, revenue: p.revenue }))} />
            </ReportSection>
            {!r.site_id && r.by_site.length > 1 && (
              <ReportSection title={t('reports.bySite')}>
                <SalesTable head={t('common.site')} total={r.summary} rows={r.by_site.map((p) => ({ key: p.site_id, name: p.name, sold: p.sold, revenue: p.revenue }))} />
              </ReportSection>
            )}
          </div>

          <button
            type="button"
            aria-expanded={showMore}
            onClick={() => setShowMore((v) => !v)}
            className="no-print min-h-11 w-full rounded-xl text-sm font-semibold text-brand-700 ring-1 ring-slate-200 hover:bg-slate-50"
          >
            {showMore ? t('reports.hideDetails') : r.period === 'day' ? t('reports.showDetailsHours') : t('reports.showDetailsDays')}
          </button>

          <div className={`space-y-3 ${showMore ? '' : 'hidden print:block'}`}>
            <ReportSection
              title={r.period === 'day' ? t('reports.perHour') : t('reports.perDay')}
              aside={r.period === 'day' ? t('reports.hoursHidden') : t('reports.daysHidden')}
            >
              <table className="w-full text-start text-sm">
                <thead>
                  <tr>
                    <th className={th}>{r.period === 'day' ? t('reports.hour') : t('common.day')}</th>
                    <th className={`${th} text-end`}>{t('common.sold')}</th>
                    <th className={`${th} text-end`}>{t('common.revenue')}</th>
                  </tr>
                </thead>
                <tbody>
                  {shownBreakdown.map((b, i) => (
                    <tr key={i} className={b.kind === 'subtotal' ? 'border-t border-slate-300 bg-slate-50 font-semibold' : 'border-t border-slate-100'}>
                      <td className={`${td} tabular-nums`}>{b.label}</td>
                      <td className={`${td} text-end tabular-nums`}>{formatNumber(b.sold)}</td>
                      <td className={`${td} text-end tabular-nums`}>{formatSSP(b.revenue)}</td>
                    </tr>
                  ))}
                  {shownBreakdown.length === 0 && (
                    <tr>
                      <td colSpan={3} className="py-3 text-slate-500">
                        {t('reports.noSales')}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </ReportSection>

            <ReportSection title={t('reports.vouchersCreated')} aside={t('reports.statusNow')}>
              <div className="flex flex-wrap gap-x-5 gap-y-1 py-2 text-sm">
                {(
                  [
                    [t('reports.created'), r.voucher_status.created],
                    [t('voucher.unused'), r.voucher_status.unused],
                    [t('voucher.sold'), r.voucher_status.sold],
                    [t('voucher.active'), r.voucher_status.active],
                    [t('voucher.expired'), r.voucher_status.expired],
                    [t('voucher.disabled'), r.voucher_status.disabled],
                  ] as const
                ).map(([k, v]) => (
                  <span key={k}>
                    <span className="text-slate-500">{k}</span> <span className="font-bold tabular-nums">{formatNumber(v)}</span>
                  </span>
                ))}
              </div>
            </ReportSection>

            <ReportSection title={t('reports.routerVouchers')} aside={r.router_logins.length >= 500 ? t('reports.latest500') : `${formatNumber(r.router_logins.length)}`} className="print:hidden">
              <p className="pt-2 text-xs text-slate-500">{t('reports.routerHint')}</p>
              <table className="w-full text-start text-sm">
                <thead>
                  <tr>
                    <th className={th}>{t('reports.code')}</th>
                    <th className={th}>{t('common.plan')}</th>
                    <th className={th}>{t('reports.firstUsed')}</th>
                    <th className={`${th} text-end`}>{t('reports.sale')}</th>
                  </tr>
                </thead>
                <tbody>
                  {r.router_logins.map((l) => (
                    <tr key={`${l.router_id}:${l.username}`} className="border-t border-slate-100">
                      <td className={`${td} font-mono`}>
                        <span dir="ltr">{l.username}</span>
                      </td>
                      <td className={td}>{l.plan ? profileLabel(l.plan) : '—'}</td>
                      <td className={`${td} tabular-nums`}>{l.first_login_at ? formatJubaTime(l.first_login_at) : t('reports.earlier')}</td>
                      <td className={`${td} text-end tabular-nums ${l.new && l.price_ssp ? 'font-semibold' : 'text-slate-500'}`}>
                        {l.new && l.price_ssp ? formatSSP(l.price_ssp) : '—'}
                      </td>
                    </tr>
                  ))}
                  {r.router_logins.length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-3 text-slate-500">
                        {t('reports.noneInPeriod')}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </ReportSection>
          </div>

          <p className="no-print text-xs text-slate-500">{t('reports.footer')}</p>
        </>
      )}
    </div>
  );
}
