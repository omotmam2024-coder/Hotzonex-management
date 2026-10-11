import { useMemo, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthProvider';
import { Alert, Button, Card, Field, Select, Spinner, TextInput } from '../components/ui';
import { downloadText, toCsv } from '../lib/csv';
import { friendlyError } from '../lib/errors';
import { formatJubaTime, formatNumber, formatSSP, jubaToday } from '../lib/format';
import { profileLabel } from '../lib/mikroticket';
import { usePlans, useSites } from '../lib/queries';
import { supabase } from '../lib/supabase';

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
  router_logins: { username: string; plan: string | null; price_ssp: number | null; first_login_at: string | null; last_seen_at: string; new: boolean }[];
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

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="report-section !p-0">
      <h2 className="px-4 pt-4 text-lg font-bold">{title}</h2>
      <div className="overflow-x-auto px-4 pb-4 pt-2">{children}</div>
    </Card>
  );
}

const th = 'py-2 pr-3 text-xs font-semibold uppercase tracking-wide text-slate-500';
const td = 'py-1.5 pr-3';

export function ReportsPage() {
  const { profile, siteName: mySite } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const sites = useSites();
  const plans = usePlans();
  const [params, setParams] = useSearchParams();
  const tab = (['day', 'week', 'month'].includes(params.get('tab') ?? '') ? params.get('tab') : 'day') as Period;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(params.get('date') ?? '') ? (params.get('date') as string) : jubaToday();
  const siteId = isAdmin ? (params.get('site') ?? '') : '';
  const planId = params.get('plan') ?? '';
  const sellerId = params.get('seller') ?? '';

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
      return data as Report;
    },
  });

  const r = report.data;
  const scope = isAdmin ? (siteId ? (sites.data?.find((s) => s.id === siteId)?.name ?? '') : 'All sites') : (mySite ?? '');
  const planName = planId ? (plans.data?.find((p) => p.id === planId)?.name ?? '') : 'All plans';
  const sellerName = sellerId ? (staff.data?.find((s) => s.id === sellerId)?.full_name ?? '') : 'All sellers';
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
      ['Seller', sellerName],
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
      ['Seller', 'Vouchers sold', 'Revenue (SSP)'],
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

  return (
    <div className="space-y-4">
      <style>{`@page { size: A4 portrait; margin: 12mm; } @media print { .report-section { break-inside: avoid; box-shadow: none; border: 1px solid #e2e8f0; } }`}</style>

      {/* Print header */}
      <div className="hidden print:block">
        <div className="text-xl font-extrabold">Hotzonex WiFi — {noun} sales report</div>
        <div className="mt-1 text-sm">
          {label} · {scope} · {planName} · {sellerName}
        </div>
        <div className="text-xs text-slate-600">Generated {generatedFmt.format(new Date())} (Juba time). Voided sales are excluded.</div>
      </div>

      <div className="no-print flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Reports</h1>
          <p className="text-slate-600">Africa/Juba time · voided sales are excluded</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => window.print()} disabled={!r}>
            🖨 Print
          </Button>
          <Button variant="secondary" onClick={exportCsv} disabled={!r}>
            ⬇ Export CSV
          </Button>
        </div>
      </div>

      <div className="no-print grid grid-cols-3 gap-2" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => set('tab', t.key)}
            className={`min-h-12 rounded-xl font-semibold ring-1 ${tab === t.key ? 'bg-brand-600 text-white ring-brand-600' : 'bg-white text-slate-700 ring-slate-300'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <Card className="no-print">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label={tab === 'day' ? 'Day' : tab === 'week' ? 'Any day in the week' : 'Month'}>
            <div className="flex gap-1">
              <button type="button" aria-label="Previous period" onClick={() => set('date', shift(date, tab, -1))} className="min-h-11 rounded-xl px-3 ring-1 ring-slate-300">
                ‹
              </button>
              {tab === 'month' ? (
                <TextInput type="month" value={date.slice(0, 7)} onChange={(e) => e.target.value && set('date', `${e.target.value}-01`)} />
              ) : (
                <TextInput type="date" value={date} onChange={(e) => e.target.value && set('date', e.target.value)} />
              )}
              <button type="button" aria-label="Next period" onClick={() => set('date', shift(date, tab, 1))} className="min-h-11 rounded-xl px-3 ring-1 ring-slate-300">
                ›
              </button>
            </div>
          </Field>
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
          <Field label="Seller">
            <Select value={sellerId} onChange={(e) => set('seller', e.target.value)}>
              <option value="">All sellers</option>
              {(staff.data ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.full_name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {r && (
          <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
            <span className="font-semibold text-slate-900">{label}</span>
            {!isCurrent && (
              <button type="button" onClick={() => set('date', '')} className="font-semibold text-brand-700 hover:underline">
                Back to {tab === 'day' ? 'today' : tab === 'week' ? 'this week' : 'this month'}
              </button>
            )}
            {report.isFetching && <Spinner className="h-4 w-4 text-brand-600" />}
          </div>
        )}
      </Card>

      {report.error && <Alert tone="error">{friendlyError(report.error)}</Alert>}
      {report.isLoading && <Spinner className="h-8 w-8 text-brand-600" />}

      {r && (
        <>
          <div className="report-section grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Card>
              <div className="text-sm text-slate-500">Vouchers sold</div>
              <div className="text-2xl font-extrabold tabular-nums sm:text-3xl">{formatNumber(r.summary.sold)}</div>
            </Card>
            <Card>
              <div className="text-sm text-slate-500">Revenue</div>
              <div className="text-2xl font-extrabold tabular-nums sm:text-3xl">{formatSSP(r.summary.revenue)}</div>
            </Card>
            <Card>
              <div className="text-sm text-slate-500">Average sale</div>
              <div className="text-2xl font-extrabold tabular-nums sm:text-3xl">{formatSSP(r.summary.average)}</div>
            </Card>
            <Card>
              <div className="text-sm text-slate-500">Change vs previous {tab}</div>
              <div className="text-2xl font-extrabold tabular-nums sm:text-3xl">
                {change === null || change === undefined ? '—' : `${change > 0 ? '▲ +' : change < 0 ? '▼ ' : ''}${change}%`}
              </div>
              <div className="text-xs text-slate-500">Previous: {formatSSP(r.summary.previous_revenue)}</div>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Section title="By plan">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr>
                    <th className={th}>Plan</th>
                    <th className={`${th} text-right`}>Sold</th>
                    <th className={`${th} text-right`}>Revenue</th>
                    <th className={`${th} w-28 text-right`}>Share</th>
                  </tr>
                </thead>
                <tbody>
                  {r.by_plan.map((p) => (
                    <tr key={p.plan_id} className="border-t border-slate-100">
                      <td className={td}>
                        <span className="flex items-center gap-2">
                          <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: p.color, printColorAdjust: 'exact', WebkitPrintColorAdjust: 'exact' }} />
                          {p.name}
                        </span>
                      </td>
                      <td className={`${td} text-right tabular-nums`}>{formatNumber(p.sold)}</td>
                      <td className={`${td} text-right font-semibold tabular-nums`}>{formatSSP(p.revenue)}</td>
                      <td className={`${td} text-right tabular-nums`}>{p.share_pct}%</td>
                    </tr>
                  ))}
                  {r.by_plan.length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-3 text-slate-500">
                        No sales.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </Section>

            <Section title="By seller">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr>
                    <th className={th}>Seller</th>
                    <th className={`${th} text-right`}>Sold</th>
                    <th className={`${th} text-right`}>Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {r.by_seller.map((p) => (
                    <tr key={p.seller_id ?? p.name} className="border-t border-slate-100">
                      <td className={td}>{p.name}</td>
                      <td className={`${td} text-right tabular-nums`}>{formatNumber(p.sold)}</td>
                      <td className={`${td} text-right font-semibold tabular-nums`}>{formatSSP(p.revenue)}</td>
                    </tr>
                  ))}
                  {r.by_seller.length === 0 && (
                    <tr>
                      <td colSpan={3} className="py-3 text-slate-500">
                        No sales.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </Section>

            {!r.site_id && (
              <Section title="By site">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr>
                      <th className={th}>Site</th>
                      <th className={`${th} text-right`}>Sold</th>
                      <th className={`${th} text-right`}>Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.by_site.map((p) => (
                      <tr key={p.site_id} className="border-t border-slate-100">
                        <td className={td}>{p.name}</td>
                        <td className={`${td} text-right tabular-nums`}>{formatNumber(p.sold)}</td>
                        <td className={`${td} text-right font-semibold tabular-nums`}>{formatSSP(p.revenue)}</td>
                      </tr>
                    ))}
                    {r.by_site.length === 0 && (
                      <tr>
                        <td colSpan={3} className="py-3 text-slate-500">
                          No sales.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </Section>
            )}

            <Section title="Voucher status">
              <p className="mb-2 text-sm text-slate-600">Vouchers created in this period, by their status now.</p>
              <div className="grid grid-cols-3 gap-2 text-center sm:grid-cols-6">
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
                  <div key={k} className="rounded-xl bg-slate-50 p-2">
                    <div className="text-xl font-extrabold tabular-nums">{formatNumber(v)}</div>
                    <div className="text-xs text-slate-500">{k}</div>
                  </div>
                ))}
              </div>
            </Section>
          </div>

          <Section title={r.period === 'day' ? 'Sales per hour' : r.period === 'week' ? 'Sales per day' : 'Sales per day, with weekly subtotals'}>
            <table className="w-full text-left text-sm">
              <thead>
                <tr>
                  <th className={th}>{r.period === 'day' ? 'Hour' : 'Day'}</th>
                  <th className={`${th} text-right`}>Sold</th>
                  <th className={`${th} text-right`}>Revenue</th>
                </tr>
              </thead>
              <tbody>
                {breakdownRows.map((b, i) =>
                  b.kind === 'subtotal' ? (
                    <tr key={i} className="border-t-2 border-slate-300 bg-slate-50 font-semibold">
                      <td className={td}>{b.label}</td>
                      <td className={`${td} text-right tabular-nums`}>{formatNumber(b.sold)}</td>
                      <td className={`${td} text-right tabular-nums`}>{formatSSP(b.revenue)}</td>
                    </tr>
                  ) : (
                    <tr key={i} className={`border-t border-slate-100 ${b.sold === 0 ? 'text-slate-400' : ''}`}>
                      <td className={`${td} tabular-nums`}>{b.label}</td>
                      <td className={`${td} text-right tabular-nums`}>{formatNumber(b.sold)}</td>
                      <td className={`${td} text-right tabular-nums`}>{formatSSP(b.revenue)}</td>
                    </tr>
                  ),
                )}
                <tr className="border-t-2 border-slate-900 font-bold">
                  <td className={td}>Total</td>
                  <td className={`${td} text-right tabular-nums`}>{formatNumber(r.summary.sold)}</td>
                  <td className={`${td} text-right tabular-nums`}>{formatSSP(r.summary.revenue)}</td>
                </tr>
              </tbody>
            </table>
          </Section>

          <Section title="Users who logged in on the router">
            <p className="mb-2 text-sm text-slate-600">
              Hotspot users seen online in this period, including MikroTicket vouchers. A user's <strong>first login</strong> counts as a sale at its plan's
              price; users who had logged in before are listed without a price.
            </p>
            <table className="w-full text-left text-sm">
              <thead>
                <tr>
                  <th className={th}>User</th>
                  <th className={th}>Plan</th>
                  <th className={th}>First login</th>
                  <th className={`${th} text-right`}>Sale</th>
                </tr>
              </thead>
              <tbody>
                {r.router_logins.map((l) => (
                  <tr key={l.username} className="border-t border-slate-100">
                    <td className={`${td} font-mono`}>{l.username}</td>
                    <td className={td}>{l.plan ? profileLabel(l.plan) : '—'}</td>
                    <td className={`${td} tabular-nums`}>{l.first_login_at ? formatJubaTime(l.first_login_at) : 'before this period'}</td>
                    <td className={`${td} text-right tabular-nums ${l.new && l.price_ssp ? 'font-semibold' : 'text-slate-400'}`}>
                      {l.new && l.price_ssp ? formatSSP(l.price_ssp) : '—'}
                    </td>
                  </tr>
                ))}
                {r.router_logins.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-3 text-slate-500">
                      No logins seen on the routers in this period.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </Section>
        </>
      )}
    </div>
  );
}
