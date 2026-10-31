import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../auth/AuthProvider';
import { PageHeader } from '../../components/PageHeader';
import { RevenueChart } from '../../components/RevenueChart';
import { Alert, Card, Select, Spinner } from '../../components/ui';
import { useSites } from '../../hooks/queries';
import { useT } from '../../i18n';
import { getLang, LOCALE } from '../../i18n/core';
import { friendlyError } from '../../lib/errors';
import { formatNumber, formatSSP } from '../../lib/format';
import { shortDay, utc } from '../../lib/period';
import { supabase } from '../../lib/supabase';

interface Bucket {
  sold: number;
  ssp: number;
}
interface Flag {
  kind: 'revenue_drop' | 'void_rate' | 'discount_heavy';
  seller?: string;
  voids?: number;
  discounted?: number;
  total?: number;
  last7?: number;
  prev7?: number;
  drop_pct?: number;
}
interface Insights {
  days: number;
  total_ssp: number;
  total_sold: number;
  daily: { day: string; sold: number; ssp: number }[];
  by_hour: (Bucket & { hour: number })[];
  by_weekday: (Bucket & { weekday: number })[];
  by_plan: (Bucket & { plan_id: string | null; name: string; color: string })[];
  forecast: { days: { day: string; expected_ssp: number }[]; expected_total_ssp: number } | null;
  flags: Flag[];
}

const weekdayName = (w: number) => new Intl.DateTimeFormat(LOCALE[getLang()], { weekday: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2024, 0, 7 + w)));

/** Labelled horizontal bars sized by revenue (the share of the biggest one). */
function Bars({ rows }: { rows: { key: string; label: string; ssp: number; sold: number; color?: string; best?: boolean }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.ssp));
  return (
    <ul className="space-y-1.5">
      {rows.map((r) => (
        <li key={r.key} className="flex items-center gap-2 text-sm">
          <span className="w-24 shrink-0 truncate text-slate-700" title={r.label}>{r.label}</span>
          <span className="h-4 min-w-0 flex-1 rounded bg-slate-100" dir="ltr">
            <span className={`block h-4 rounded ${r.best ? 'bg-accent-500' : 'bg-brand-500'}`} style={{ width: `${(r.ssp / max) * 100}%`, ...(r.color ? { backgroundColor: r.color } : {}) }} />
          </span>
          <span className="w-28 shrink-0 text-end tabular-nums text-slate-700">{formatSSP(r.ssp)}</span>
          <span className="w-12 shrink-0 text-end text-xs tabular-nums text-slate-500">{formatNumber(r.sold)}</span>
        </li>
      ))}
    </ul>
  );
}

/** Owners and managers: when and what sells, a forecast, and flags for unusual activity. */
export function InsightsPage() {
  const { t } = useT();
  const { profile } = useAuth();
  const sites = useSites();
  const isAdmin = profile?.role === 'admin';
  const [days, setDays] = useState(28);
  const [siteId, setSiteId] = useState('');

  const q = useQuery({
    queryKey: ['insights', days, siteId],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Insights> => {
      const { data, error } = await supabase.rpc('sales_insights', { p_days: days, p_site_id: siteId || null });
      if (error) throw new Error(friendlyError(error));
      return data as unknown as Insights;
    },
  });
  const d = q.data;
  const bestHour = d ? d.by_hour.reduce((b, x) => (x.ssp > b.ssp ? x : b), d.by_hour[0]!) : null;
  const bestDay = d ? d.by_weekday.reduce((b, x) => (x.ssp > b.ssp ? x : b), d.by_weekday[0]!) : null;
  const hasSales = (d?.total_sold ?? 0) > 0;

  function flagText(f: Flag): string {
    switch (f.kind) {
      case 'revenue_drop':
        return t('insights.flag.drop', { pct: f.drop_pct ?? 0, last: formatSSP(f.last7 ?? 0), prev: formatSSP(f.prev7 ?? 0) });
      case 'void_rate':
        return t('insights.flag.voids', { name: f.seller ?? '?', voids: f.voids ?? 0, total: f.total ?? 0 });
      case 'discount_heavy':
        return t('insights.flag.discounts', { name: f.seller ?? '?', n: f.discounted ?? 0, total: f.total ?? 0 });
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('insights.title')}
        subtitle={t('insights.subtitle')}
        actions={
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <Select value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label={t('insights.period')}>
              {[14, 28, 60, 90].map((n) => (
                <option key={n} value={n}>
                  {t('insights.lastDays', { n })}
                </option>
              ))}
            </Select>
            {isAdmin && (sites.data?.length ?? 0) > 1 && (
              <Select value={siteId} onChange={(e) => setSiteId(e.target.value)} aria-label={t('common.site')}>
                <option value="">{t('common.allSites')}</option>
                {(sites.data ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            )}
          </div>
        }
      />
      {q.isLoading && <Spinner className="mx-auto block h-10 w-10 text-brand-600" />}
      {q.error && <Alert tone="error">{friendlyError(q.error)}</Alert>}
      {d && !hasSales && <Alert tone="info">{t('insights.noSales')}</Alert>}

      {d && hasSales && bestHour && bestDay && (
        <>
          {d.flags.length > 0 && (
            <Card>
              <h2 className="mb-2 text-lg font-bold">{t('insights.flags')}</h2>
              <div className="space-y-2">
                {d.flags.map((f, i) => (
                  <Alert key={i} tone="warning">
                    {flagText(f)}
                  </Alert>
                ))}
              </div>
              <p className="mt-2 text-xs text-slate-500">{t('insights.flagsNote')}</p>
            </Card>
          )}

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              { label: t('insights.revenue'), value: formatSSP(d.total_ssp) },
              { label: t('insights.sold'), value: formatNumber(d.total_sold) },
              { label: t('insights.bestHour'), value: `${bestHour.hour}:00–${(bestHour.hour + 1) % 24}:00` },
              { label: t('insights.bestDay'), value: weekdayName(bestDay.weekday) },
            ].map((c) => (
              <Card key={c.label}>
                <div className="text-sm text-slate-600">{c.label}</div>
                <div className="text-xl font-bold tabular-nums sm:text-2xl">{c.value}</div>
              </Card>
            ))}
          </div>

          <Card>
            <RevenueChart days={d.daily.map((x) => ({ day: x.day, revenue: x.ssp, sold: x.sold }))} />
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <h2 className="mb-1 text-lg font-bold">{t('insights.byHour')}</h2>
              <p className="mb-3 text-xs text-slate-500">{t('insights.barsNote')}</p>
              <Bars rows={d.by_hour.filter((h) => h.hour >= 5 || h.sold > 0).map((h) => ({ key: String(h.hour), label: `${h.hour}:00`, ssp: h.ssp, sold: h.sold, best: h.hour === bestHour.hour }))} />
            </Card>
            <div className="space-y-4">
              <Card>
                <h2 className="mb-3 text-lg font-bold">{t('insights.byWeekday')}</h2>
                <Bars rows={d.by_weekday.map((w) => ({ key: String(w.weekday), label: weekdayName(w.weekday), ssp: w.ssp, sold: w.sold, best: w.weekday === bestDay.weekday }))} />
              </Card>
              <Card>
                <h2 className="mb-3 text-lg font-bold">{t('insights.byPlan')}</h2>
                <Bars rows={d.by_plan.map((p) => ({ key: p.plan_id ?? p.name, label: p.name, ssp: p.ssp, sold: p.sold, color: p.color }))} />
              </Card>
            </div>
          </div>

          <Card>
            <h2 className="mb-1 text-lg font-bold">{t('insights.forecast')}</h2>
            {d.forecast ? (
              <>
                <p className="mb-3 text-sm text-slate-600">{t('insights.forecastText', { total: formatSSP(d.forecast.expected_total_ssp) })}</p>
                <ul className="grid gap-1 text-sm sm:grid-cols-2 lg:grid-cols-4">
                  {d.forecast.days.map((f) => (
                    <li key={f.day} className="flex justify-between rounded-lg bg-slate-50 px-3 py-2">
                      <span>{shortDay.format(utc(f.day))}</span>
                      <span className="font-semibold tabular-nums">{formatSSP(f.expected_ssp)}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-slate-500">{t('insights.forecastNote')}</p>
              </>
            ) : (
              <p className="text-sm text-slate-600">{t('insights.forecastNeeds')}</p>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
