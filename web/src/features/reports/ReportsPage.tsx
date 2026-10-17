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
  const hasExtra = rows.some((x) => x.extra !== undefined);
  return (
    <table className="w-full text-left text-sm">
      <thead>
        <tr>
          <th className={th}>{head}</th>
          <th className={`${th} text-right`}>Sold</th>
          <th className={`${th} text-right`}>Revenue</th>
          {hasExtra && <th className={`${th} text-right`}>Share</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((x) => (
          <tr key={x.key} className="border-t border-slate-100">
            <td className={td}>{x.name}</td>
            <td className={`${td} text-right tabular-nums`}>{formatNumber(x.sold)}</td>
            <td className={`${td} text-right font-semibold tabular-nums`}>{formatSSP(x.revenue)}</td>
            {hasExtra && <td className={`${td} text-right tabular-nums text-slate-500`}>{x.extra}</td>}
          </tr>
        ))}
        {rows.length === 0 && (
          <tr>
            <td colSpan={hasExtra ? 4 : 3} className="py-3 text-slate-500">
              No sales.
            </td>
          </tr>
        )}
        {total && rows.length > 1 && (
          <tr className="border-t border-slate-300 font-bold">
            <td className={td}>Total</td>
            <td className={`${td} text-right tabular-nums`}>{formatNumber(total.sold)}</td>
            <td className={`${td} text-right tabular-nums`}>{formatSSP(total.revenue)}</td>
            {hasExtra && <td className={td} />}
          </tr>
        )}
      </tbody>
    </table>
  );
}

export function ReportsPage() {
  const { profile, siteName: mySite, business } = useAuth();
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
  const scope = isAdmin ? (siteId ? (sites.data?.find((s) => s.id === siteId)?.name ?? '') : 'All sites') : (mySite ?? '');
  const planName = planId ? (plans.data?.find((p) => p.id === planId)?.name ?? '') : 'All plans';
  const sellerName = sellerId ? (staff.data?.find((s) => s.id === sellerId)?.full_name ?? '') : 'All cashiers and agents';
  const label = r ? periodLabel(tab, r.start, r.end) : '';
  const noun = PERIODS.find((t) => t.key === tab)?.noun ?? '';
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
          out.push({ kind: 'subtotal', label: `Week ${shortDay.format(utc(wk.from))} – ${shortDay.format(utc(day))}`, sold: wk.sold, revenue: wk.revenue });
          wk = { sold: 0, revenue: 0, from: '' };
        }
      }
    });
    return out;
  }, [r]);

  function exportCsv() {
    if (!r) return;
    const s = r.summary;
    const rows: (string | number | null)[][] = [
      [businessName, `${noun} sales report`],
      ['Period', label],
      ['Site', scope],
      ['Plan', planName],
      ['Cashier / agent', sellerName],
      ['Generated', formatJubaStamp()],
      ['Note', 'Africa/Juba time. Voided sales are excluded.'],
      [],
      ['Summary'],
      ['Vouchers sold', s.sold],
      ['Revenue (SSP)', s.revenue],
      ['Average sale (SSP)', s.average],
      ['Previous period revenue (SSP)', s.previous_revenue],
      ['Change vs previous period (%)', s.change_pct],
      [],
      ['By plan'],
      ['Plan', 'Vouchers sold', 'Revenue (SSP)', 'Share of revenue (%)'],
      ...r.by_plan.map((p) => [p.name, p.sold, p.revenue, p.share_pct]),
      [],
      ['By seller'],
      ['Cashier / agent', 'Vouchers sold', 'Revenue (SSP)'],
      ...r.by_seller.map((p) => [p.name, p.sold, p.revenue]),
    ];
    if (!r.site_id) rows.push([], ['By site'], ['Site', 'Vouchers sold', 'Revenue (SSP)'], ...r.by_site.map((p) => [p.name, p.sold, p.revenue]));
    rows.push([], [r.period === 'day' ? 'Sales per hour' : 'Sales per day'], [r.period === 'day' ? 'Hour' : 'Day', 'Vouchers sold', 'Revenue (SSP)']);
    for (const b of breakdownRows) rows.push([b.kind === 'subtotal' ? `Subtotal: ${b.label}` : b.label, b.sold, b.revenue]);
    const v = r.voucher_status;
    rows.push(
      [],
      ['Vouchers created in this period, by status now'],
      ['Created', 'Unused', 'Sold', 'Active', 'Expired', 'Disabled'],
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
        { label: 'Revenue', value: formatSSP(r.summary.revenue), sub: usdRate ? formatUsd(r.summary.revenue, usdRate) : undefined },
        { label: 'Vouchers sold', value: formatNumber(r.summary.sold) },
        { label: 'Average sale', value: formatSSP(r.summary.average) },
        {
          label: `vs previous ${tab}`,
          value: change === null || change === undefined ? '—' : `${change > 0 ? '+' : ''}${change}%`,
          sub: <>was {formatSSP(r.summary.previous_revenue)}</>,
        },
      ]
    : [];

  return (
    <div className="space-y-4">
      <ReportPrintStyle />

      {/* Print header */}
      <div className="hidden print:block">
        <div className="text-lg font-extrabold">
          {businessName} — {noun} sales report
        </div>
        <div className="text-sm">
          {label} · {scope} · {planName} · {sellerName}
        </div>
        <div className="text-xs text-slate-600">Generated {formatJubaStamp()} (Juba time). Voided sales are excluded.</div>
      </div>

      <div className="no-print">
        <PageHeader
          title="Reports"
          subtitle="Sales by day, week or month"
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
        <Button
          variant="secondary"
          aria-expanded={showFilters}
          onClick={() => setShowFilters((v) => !v)}
          className={`px-3 text-sm ${filterCount ? '!bg-brand-50 !text-brand-800 !ring-brand-200' : ''}`}
        >
          Filters{filterCount ? ` (${filterCount})` : ''}
        </Button>
        {report.isFetching && <Spinner className="h-4 w-4 text-brand-600" />}
      </PeriodPicker>

      {showFilters && (
        <Card className="no-print !p-3">
          <div className="grid gap-3 sm:grid-cols-3">
            {isAdmin && (
              <Field label="Site">
                <Select value={siteId} onChange={(e) => set('site', e.target.value)}>
                  <option value="">All sites</option>
                  {(sites.data ?? []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <Field label="Plan">
              <Select value={planId} onChange={(e) => set('plan', e.target.value)}>
                <option value="">All plans</option>
                {(plans.data ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Cashier / agent">
              <Select value={sellerId} onChange={(e) => set('seller', e.target.value)}>
                <option value="">Everyone</option>
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
                <div key={x.label} className={i > 0 ? 'sm:border-l sm:border-slate-100 sm:pl-4' : ''}>
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
              <p className="mt-3 border-t border-slate-100 pt-3 text-xs text-slate-500">Profit could not be loaded: {friendlyError(profit.error)}</p>
            )}
            {showProfit && profit.data && (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-slate-100 pt-3 text-sm">
                <span className="text-slate-600">
                  Commission <span className="font-semibold tabular-nums text-slate-900">{formatSSP(profit.data.summary.commission)}</span>
                  {' · '}Expenses <span className="font-semibold tabular-nums text-slate-900">{formatSSP(profit.data.summary.expenses)}</span>
                  {' · '}Profit{' '}
                  <span className={`font-bold tabular-nums ${profitTone(profit.data.summary.profit)}`}>{formatSSP(profit.data.summary.profit)}</span>
                </span>
                <Link to={`/expenses?${params.toString()}`} className="no-print inline-flex min-h-11 items-center font-semibold text-brand-700 hover:underline">
                  Expenses &amp; profit ›
                </Link>
              </div>
            )}
          </section>

          <div className="grid gap-3 lg:grid-cols-2">
            <ReportSection title="By plan">
              <SalesTable
                head="Plan"
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
            <ReportSection title="By cashier / agent">
              <SalesTable head="Name" total={r.summary} rows={r.by_seller.map((p) => ({ key: p.seller_id ?? p.name, name: p.name, sold: p.sold, revenue: p.revenue }))} />
            </ReportSection>
            {!r.site_id && r.by_site.length > 1 && (
              <ReportSection title="By site">
                <SalesTable head="Site" total={r.summary} rows={r.by_site.map((p) => ({ key: p.site_id, name: p.name, sold: p.sold, revenue: p.revenue }))} />
              </ReportSection>
            )}
          </div>

          <button
            type="button"
            aria-expanded={showMore}
            onClick={() => setShowMore((v) => !v)}
            className="no-print min-h-11 w-full rounded-xl text-sm font-semibold text-brand-700 ring-1 ring-slate-200 hover:bg-slate-50"
          >
            {showMore ? 'Hide details' : `Show details (${r.period === 'day' ? 'hours' : 'days'}, voucher status, router vouchers)`}
          </button>

          <div className={`space-y-3 ${showMore ? '' : 'hidden print:block'}`}>
            <ReportSection title={r.period === 'day' ? 'Sales per hour' : 'Sales per day'} aside={r.period === 'day' ? 'hours with no sales hidden' : 'days with no sales hidden'}>
              <table className="w-full text-left text-sm">
                <thead>
                  <tr>
                    <th className={th}>{r.period === 'day' ? 'Hour' : 'Day'}</th>
                    <th className={`${th} text-right`}>Sold</th>
                    <th className={`${th} text-right`}>Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {shownBreakdown.map((b, i) => (
                    <tr key={i} className={b.kind === 'subtotal' ? 'border-t border-slate-300 bg-slate-50 font-semibold' : 'border-t border-slate-100'}>
                      <td className={`${td} tabular-nums`}>{b.label}</td>
                      <td className={`${td} text-right tabular-nums`}>{formatNumber(b.sold)}</td>
                      <td className={`${td} text-right tabular-nums`}>{formatSSP(b.revenue)}</td>
                    </tr>
                  ))}
                  {shownBreakdown.length === 0 && (
                    <tr>
                      <td colSpan={3} className="py-3 text-slate-500">
                        No sales.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </ReportSection>

            <ReportSection title="Vouchers created in this period" aside="status now">
              <div className="flex flex-wrap gap-x-5 gap-y-1 py-2 text-sm">
                {(
                  [
                    ['Created', r.voucher_status.created],
                    ['Unused', r.voucher_status.unused],
                    ['Sold', r.voucher_status.sold],
                    ['Active', r.voucher_status.active],
                    ['Expired', r.voucher_status.expired],
                    ['Disabled', r.voucher_status.disabled],
                  ] as const
                ).map(([k, v]) => (
                  <span key={k}>
                    <span className="text-slate-500">{k}</span> <span className="font-bold tabular-nums">{formatNumber(v)}</span>
                  </span>
                ))}
              </div>
            </ReportSection>

            <ReportSection title="Router vouchers used" aside={r.router_logins.length >= 500 ? 'latest 500' : `${formatNumber(r.router_logins.length)}`} className="print:hidden">
              <p className="pt-2 text-xs text-slate-500">MikroTicket and other router vouchers. Each counts as a sale at its plan's price when first used.</p>
              <table className="w-full text-left text-sm">
                <thead>
                  <tr>
                    <th className={th}>Code</th>
                    <th className={th}>Plan</th>
                    <th className={th}>First used</th>
                    <th className={`${th} text-right`}>Sale</th>
                  </tr>
                </thead>
                <tbody>
                  {r.router_logins.map((l) => (
                    <tr key={`${l.router_id}:${l.username}`} className="border-t border-slate-100">
                      <td className={`${td} font-mono`}>{l.username}</td>
                      <td className={td}>{l.plan ? profileLabel(l.plan) : '—'}</td>
                      <td className={`${td} tabular-nums`}>{l.first_login_at ? formatJubaTime(l.first_login_at) : 'earlier'}</td>
                      <td className={`${td} text-right tabular-nums ${l.new && l.price_ssp ? 'font-semibold' : 'text-slate-500'}`}>
                        {l.new && l.price_ssp ? formatSSP(l.price_ssp) : '—'}
                      </td>
                    </tr>
                  ))}
                  {r.router_logins.length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-3 text-slate-500">
                        None in this period.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </ReportSection>
          </div>

          <p className="no-print text-xs text-slate-500">Juba time. Voided sales are not counted.</p>
        </>
      )}
    </div>
  );
}
