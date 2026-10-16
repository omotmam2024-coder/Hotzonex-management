import { useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useAuth } from '../../auth/AuthProvider';
import { Alert, Button, Card, Field, Select, Spinner, TextInput } from '../../components/ui';
import { downloadText, toCsv } from '../../lib/csv';
import { friendlyError } from '../../lib/errors';
import { useUsdRate } from '../../hooks/useBusinessSettings';
import { formatJubaTime, formatNumber, formatSSP, formatUsd, jubaToday } from '../../lib/format';
import { profileLabel } from '../../lib/mikroticket';
import { usePlans, useSites } from '../../hooks/queries';
import { fromJson, supabase } from '../../lib/supabase';

type Period = 'day' | 'week' | 'month';

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

const TABS: { key: Period; label: string; noun: string }[] = [
  { key: 'day', label: 'Daily', noun: 'Daily' },
  { key: 'week', label: 'Weekly', noun: 'Weekly' },
  { key: 'month', label: 'Monthly', noun: 'Monthly' },
];

const utc = (d: string) => new Date(`${d}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-GB', { ...opts, timeZone: 'UTC' });
const longDay = fmt({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const shortDay = fmt({ weekday: 'short', day: 'numeric', month: 'short' });
const monthYear = fmt({ month: 'long', year: 'numeric' });
const generatedFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Juba', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/** Moves a date by whole periods (days, weeks or calendar months). */
function shift(date: string, period: Period, steps: number): string {
  const d = utc(date);
  if (period === 'day') d.setUTCDate(d.getUTCDate() + steps);
  else if (period === 'week') d.setUTCDate(d.getUTCDate() + 7 * steps);
  else {
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + steps);
  }
  return iso(d);
}

export function periodLabel(period: Period, start: string, end: string): string {
  if (period === 'day') return longDay.format(utc(start));
  if (period === 'week') return `${shortDay.format(utc(start))} – ${shortDay.format(utc(end))} ${utc(end).getUTCFullYear()}`;
  return monthYear.format(utc(start));
}

function hourLabel(h: number): string {
  return `${String(h).padStart(2, '0')}:00–${String(h).padStart(2, '0')}:59`;
}

function Section({ title, aside, children, className = '' }: { title: string; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`report-section rounded-2xl bg-white shadow-card ring-1 ring-slate-200/70 ${className}`}>
      <div className="flex items-baseline justify-between gap-2 border-b border-slate-100 px-4 py-2.5">
        <h2 className="text-sm font-bold text-slate-900">{title}</h2>
        {aside && <span className="text-xs text-slate-500">{aside}</span>}
      </div>
      <div className="overflow-x-auto px-4 pb-2">{children}</div>
    </section>
  );
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
            <td colSpan={3} className="py-3 text-slate-500">
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

const th = 'py-2 pr-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500 last:pr-0';
const td = 'py-1.5 pr-3 last:pr-0';

export function ReportsPage() {
  const { profile, siteName: mySite } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const sites = useSites();
  const usdRate = useUsdRate();
  const plans = usePlans();
  const [params, setParams] = useSearchParams();
  const tab = (['day', 'week', 'month'].includes(params.get('tab') ?? '') ? params.get('tab') : 'day') as Period;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(params.get('date') ?? '') ? (params.get('date') as string) : jubaToday();
  const siteId = isAdmin ? (params.get('site') ?? '') : '';
  const planId = params.get('plan') ?? '';
  const sellerId = params.get('seller') ?? '';
  const [showFilters, setShowFilters] = useState(false);
  const [showMore, setShowMore] = useState(false);

  function set(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  }

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

  const r = report.data;
  const scope = isAdmin ? (siteId ? (sites.data?.find((s) => s.id === siteId)?.name ?? '') : 'All sites') : (mySite ?? '');
  const planName = planId ? (plans.data?.find((p) => p.id === planId)?.name ?? '') : 'All plans';
  const sellerName = sellerId ? (staff.data?.find((s) => s.id === sellerId)?.full_name ?? '') : 'All cashiers and agents';
  const label = r ? periodLabel(tab, r.start, r.end) : '';
  const noun = TABS.find((t) => t.key === tab)?.noun ?? '';
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
      ['Hotzonex WiFi', `${noun} sales report`],
      ['Period', label],
      ['Site', scope],
      ['Plan', planName],
      ['Cashier / agent', sellerName],
      ['Generated', generatedFmt.format(new Date())],
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
  const navBtn = 'min-h-11 min-w-11 rounded-xl text-lg font-semibold text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50';

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
    <div className="space-y-3">
      <style>{`@page { size: A4 portrait; margin: 12mm; } @media print { .report-section { break-inside: avoid; box-shadow: none; border: 1px solid #e2e8f0; } }`}</style>

      {/* Print header */}
      <div className="hidden print:block">
        <div className="text-lg font-extrabold">Hotzonex WiFi — {noun} sales report</div>
        <div className="text-sm">
          {label} · {scope} · {planName} · {sellerName}
        </div>
        <div className="text-xs text-slate-600">Generated {generatedFmt.format(new Date())} (Juba time). Voided sales are excluded.</div>
      </div>

      <div className="no-print flex items-center justify-between gap-2">
        <h1 className="text-xl font-bold text-slate-900">Reports</h1>
        <div className="flex gap-2">
          <Button variant="secondary" className="px-3 text-sm" onClick={() => window.print()} disabled={!r}>
            Print
          </Button>
          <Button variant="secondary" className="px-3 text-sm" onClick={exportCsv} disabled={!r}>
            CSV
          </Button>
        </div>
      </div>

      <div className="no-print flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-xl bg-slate-100 p-0.5" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => set('tab', t.key)}
              className={`min-h-10 rounded-lg px-3 text-sm font-semibold ${tab === t.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <button type="button" aria-label="Previous period" onClick={() => set('date', shift(date, tab, -1))} className={navBtn}>
            ‹
          </button>
          {tab === 'month' ? (
            <TextInput aria-label="Month" type="month" className="!w-auto text-sm" value={date.slice(0, 7)} onChange={(e) => e.target.value && set('date', `${e.target.value}-01`)} />
          ) : (
            <TextInput aria-label="Day" type="date" className="!w-auto text-sm" value={date} onChange={(e) => e.target.value && set('date', e.target.value)} />
          )}
          <button type="button" aria-label="Next period" onClick={() => set('date', shift(date, tab, 1))} className={navBtn}>
            ›
          </button>
        </div>
        <button
          type="button"
          aria-expanded={showFilters}
          onClick={() => setShowFilters((v) => !v)}
          className={`min-h-11 rounded-xl px-3 text-sm font-semibold ring-1 ${filterCount ? 'bg-brand-50 text-brand-800 ring-brand-300' : 'text-slate-700 ring-slate-300'}`}
        >
          Filters{filterCount ? ` (${filterCount})` : ''}
        </button>
        {report.isFetching && <Spinner className="h-4 w-4 text-brand-600" />}
      </div>

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
                    {tab === 'day' ? 'Today' : tab === 'week' ? 'This week' : 'This month'}
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
          </section>

          <div className="grid gap-3 lg:grid-cols-2">
            <Section title="By plan">
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
            </Section>
            <Section title="By cashier / agent">
              <SalesTable head="Name" total={r.summary} rows={r.by_seller.map((p) => ({ key: p.seller_id ?? p.name, name: p.name, sold: p.sold, revenue: p.revenue }))} />
            </Section>
            {!r.site_id && r.by_site.length > 1 && (
              <Section title="By site">
                <SalesTable head="Site" total={r.summary} rows={r.by_site.map((p) => ({ key: p.site_id, name: p.name, sold: p.sold, revenue: p.revenue }))} />
              </Section>
            )}
          </div>

          <button
            type="button"
            aria-expanded={showMore}
            onClick={() => setShowMore((v) => !v)}
            className="no-print min-h-11 w-full rounded-xl text-sm font-semibold text-brand-700 ring-1 ring-slate-200 hover:bg-slate-50"
          >
            {showMore ? 'Hide details' : `Show details (${r.period === 'day' ? 'hours' : 'days'}, voucher status, router cards)`}
          </button>

          <div className={`space-y-3 ${showMore ? '' : 'hidden print:block'}`}>
            <Section title={r.period === 'day' ? 'Sales per hour' : 'Sales per day'} aside={r.period === 'day' ? 'hours with no sales hidden' : 'days with no sales hidden'}>
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
            </Section>

            <Section title="Vouchers created in this period" aside="status now">
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
            </Section>

            <Section title="Router cards used" aside={r.router_logins.length >= 500 ? 'latest 500' : `${formatNumber(r.router_logins.length)}`} className="print:hidden">
              <p className="pt-2 text-xs text-slate-500">MikroTicket and other router cards. Each counts as a sale at its plan's price when first used.</p>
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
            </Section>
          </div>

          <p className="no-print text-xs text-slate-500">Juba time. Voided sales are not counted.</p>
        </>
      )}
    </div>
  );
}
