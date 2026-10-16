import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthProvider';
import { PageHeader } from '../components/PageHeader';
import { RevenueChart, type DayRevenue } from '../components/RevenueChart';
import { Icon } from '../components/Icon';
import { Alert, Card, Select, Spinner } from '../components/ui';
import { friendlyError } from '../lib/errors';
import { useUsdRate } from '../lib/business';
import { formatJubaTime, formatNumber, formatSSP, formatUsd } from '../lib/format';
import { useRouters, useSites } from '../lib/queries';
import type { IconName } from '../lib/nav';
import { readStored, writeStored } from '../lib/storage';
import { supabase } from '../lib/supabase';

interface StockRow {
  site_id: string;
  site_name: string;
  plan_id: string;
  plan_name: string;
  plan_color: string;
  price_ssp: number;
  available: number;
  printed_unsold: number;
}

interface Dashboard {
  today: { revenue: number; sold: number };
  week: { revenue: number; sold: number; start: string };
  month: { revenue: number; sold: number; start: string };
  online_now: number;
  router_users: { total: number; unused: number; used: number; checked_at: string | null };
  logins_today: number;
  last_14_days: DayRevenue[];
  stock: StockRow[];
}

interface ExpiringRow {
  plan_id: string;
  plan_name: string;
  plan_color: string;
  cards: number;
}

const SITE_KEY = 'hzc.dashboardSite';
const LOW_STOCK = 20;

const TONES = {
  blue: 'bg-brand-50 text-brand-600',
  green: 'bg-emerald-50 text-emerald-600',
  violet: 'bg-violet-50 text-violet-600',
  amber: 'bg-amber-50 text-amber-600',
  sky: 'bg-sky-50 text-sky-600',
  slate: 'bg-slate-100 text-slate-600',
} as const;

function StatCard({
  label,
  value,
  sub,
  to,
  icon,
  tone = 'blue',
  highlight = false,
}: {
  label: string;
  value: string;
  sub: string;
  to?: string;
  icon: IconName;
  tone?: keyof typeof TONES;
  highlight?: boolean;
}) {
  const body = highlight ? (
    <div className="h-full rounded-2xl bg-gradient-to-br from-brand-600 to-brand-800 p-4 text-white shadow-lift sm:p-5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-white/80">{label}</span>
        <span className="rounded-lg bg-white/15 p-1.5">
          <Icon name={icon} className="h-4 w-4" />
        </span>
      </div>
      <div className="mt-2 text-xl font-bold tabular-nums tracking-tight sm:text-3xl">{value}</div>
      <div className="mt-1 text-sm text-white/75">{sub}</div>
    </div>
  ) : (
    <Card className="h-full transition-shadow hover:shadow-lift">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-slate-500">{label}</span>
        <span className={`rounded-lg p-1.5 ${TONES[tone]}`}>
          <Icon name={icon} className="h-4 w-4" />
        </span>
      </div>
      <div className="mt-2 text-xl font-bold tabular-nums tracking-tight text-slate-900 sm:text-3xl">{value}</div>
      <div className="mt-1 text-sm text-slate-500">{sub}</div>
    </Card>
  );
  return to ? (
    <Link to={to} className="block rounded-2xl">
      {body}
    </Link>
  ) : (
    body
  );
}

export function DashboardPage() {
  const { profile, siteName } = useAuth();
  const sites = useSites();
  const isAdmin = profile?.role === 'admin';
  const [siteId, setSiteId] = useState<string>(() => (isAdmin ? (readStored<string>('local', SITE_KEY) ?? '') : ''));

  const dashboard = useQuery({
    queryKey: ['dashboard', siteId],
    refetchInterval: 60_000,
    queryFn: async (): Promise<Dashboard> => {
      const { data, error } = await supabase.rpc('dashboard_summary', { p_site_id: siteId || null });
      if (error) throw new Error(friendlyError(error));
      return data as Dashboard;
    },
  });

  // Cards whose validity ends in the next 24 hours (needs migration 20261016181000; hidden without it).
  const expiring = useQuery({
    queryKey: ['expiring', siteId],
    refetchInterval: 5 * 60_000,
    queryFn: async (): Promise<ExpiringRow[] | null> => {
      const { data, error } = await supabase.rpc('expiring_soon', { p_site_id: siteId || null, p_hours: 24 });
      if (error?.code === 'PGRST202') return null;
      if (error) throw new Error(friendlyError(error));
      return (data ?? []) as ExpiringRow[];
    },
  });
  const routers = useRouters(60_000);
  const usdRate = useUsdRate();
  const withUsd = (ssp: number) => {
    const usd = formatUsd(ssp, usdRate);
    return usd ? ` · ${usd}` : '';
  };
  const siteRouters = (routers.data ?? []).filter((r) => !siteId || r.site_id === siteId);

  const d = dashboard.data;
  const scope = isAdmin ? (sites.data?.find((s) => s.id === siteId)?.name ?? 'All sites') : (siteName ?? '');
  const showSiteColumn = !siteId && isAdmin && new Set((d?.stock ?? []).map((s) => s.site_id)).size > 1;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Dashboard"
        subtitle={scope}
        actions={
          isAdmin && (
            <div className="w-full sm:w-56">
              <Select
                aria-label="Site"
                value={siteId}
                onChange={(e) => {
                  setSiteId(e.target.value);
                  writeStored('local', SITE_KEY, e.target.value);
                }}
              >
                <option value="">All sites</option>
                {(sites.data ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </div>
          )
        }
      />

      {dashboard.error && <Alert tone="error">{friendlyError(dashboard.error)}</Alert>}
      {dashboard.isLoading && <Spinner className="h-8 w-8 text-brand-600" />}

      {d && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <StatCard label="Today" value={formatSSP(d.today.revenue)} sub={`${formatNumber(d.today.sold)} vouchers${withUsd(d.today.revenue)}`} to="/reports?tab=day" icon="sales" highlight />
            <StatCard label="This week" value={formatSSP(d.week.revenue)} sub={`${formatNumber(d.week.sold)} vouchers · from Mon${withUsd(d.week.revenue)}`} to="/reports?tab=week" icon="reports" tone="violet" />
            <StatCard label="This month" value={formatSSP(d.month.revenue)} sub={`${formatNumber(d.month.sold)} vouchers${withUsd(d.month.revenue)}`} to="/reports?tab=month" icon="dashboard" tone="sky" />
            <StatCard label="Online now" value={formatNumber(d.online_now)} sub="users connected" to="/active-users" icon="active" tone="green" />
            <StatCard label="Logged in today" value={formatNumber(d.logins_today)} sub="hotspot users seen on the router" to="/reports?tab=day" icon="vouchers" tone="amber" />
            <StatCard
              icon="routers"
              tone="slate"
              label="Hotspot users on router"
              value={formatNumber(d.router_users.total)}
              sub={`${formatNumber(d.router_users.unused)} unused · ${formatNumber(d.router_users.used)} used`}
              to={isAdmin ? '/routers' : '/reports?tab=day'}
            />
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <Card>
              <div className="mb-2 flex items-center justify-between gap-2">
                <h2 className="text-lg font-bold">Routers</h2>
                {isAdmin && (
                  <Link to="/routers" className="text-sm font-semibold text-brand-700 hover:underline">
                    Manage
                  </Link>
                )}
              </div>
              {siteRouters.length === 0 ? (
                <p className="text-slate-600">No router yet. {isAdmin ? 'Add your MikroTik router on the Routers page.' : 'Ask the owner to add one.'}</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {siteRouters.map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-3 py-2">
                      <span className="min-w-0 truncate font-medium text-slate-900">{r.name}</span>
                      {r.status === 'online' ? (
                        <span className="shrink-0 rounded-full bg-emerald-50 px-2.5 py-0.5 text-sm font-semibold text-emerald-700">● Online</span>
                      ) : (
                        <span className="shrink-0 text-right text-sm">
                          <span className="rounded-full bg-red-50 px-2.5 py-0.5 font-semibold text-red-700">● {r.status === 'pending' ? 'Not connected yet' : 'Offline'}</span>
                          {r.last_seen_at && <span className="block text-xs text-slate-600">last seen {formatJubaTime(r.last_seen_at)}</span>}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            {expiring.data && (
              <Card>
                <h2 className="mb-2 text-lg font-bold">Expiring in the next 24 hours</h2>
                {expiring.data.length === 0 ? (
                  <p className="text-slate-600">No customer's card runs out in the next 24 hours.</p>
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {expiring.data.map((e) => (
                      <li key={e.plan_id} className="flex items-center justify-between gap-3 py-2">
                        <span className="flex items-center gap-2 font-medium text-slate-900">
                          <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: e.plan_color }} />
                          {e.plan_name}
                        </span>
                        <span className="font-semibold tabular-nums">
                          {formatNumber(e.cards)} card{e.cards === 1 ? '' : 's'}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-2 text-sm text-slate-600">These customers may want a new card soon.</p>
              </Card>
            )}
          </div>

          <Card>
            <RevenueChart days={d.last_14_days} />
          </Card>

          <Card className="!p-0">
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4">
              <h2 className="text-lg font-bold">Stock left</h2>
              <Link to="/vouchers/generate" className="text-sm font-semibold text-brand-700 hover:underline">
                Generate vouchers
              </Link>
            </div>
            <div className="overflow-x-auto">
              <table className="mt-2 w-full text-left text-sm">
                <thead className="border-y border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    {showSiteColumn && <th className="px-4 py-2">Site</th>}
                    <th className="px-4 py-2">Plan</th>
                    <th className="px-4 py-2 text-right">For the Sell screen</th>
                    <th className="px-4 py-2 text-right">Printed, not sold</th>
                  </tr>
                </thead>
                <tbody>
                  {d.stock.map((s) => (
                    <tr key={`${s.site_id}-${s.plan_id}`} className="border-b border-slate-100 last:border-0">
                      {showSiteColumn && <td className="px-4 py-2">{s.site_name}</td>}
                      <td className="px-4 py-2">
                        <span className="flex items-center gap-2">
                          <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: s.plan_color }} />
                          {s.plan_name} <span className="text-slate-500">· {formatSSP(s.price_ssp)}</span>
                        </span>
                      </td>
                      <td className="px-4 py-2 text-right font-semibold tabular-nums">
                        {s.available === 0 ? (
                          <span className="text-red-700">0 — out</span>
                        ) : s.available < LOW_STOCK ? (
                          <span className="text-amber-700">⚠ {formatNumber(s.available)}</span>
                        ) : (
                          formatNumber(s.available)
                        )}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-slate-600">{formatNumber(s.printed_unsold)}</td>
                    </tr>
                  ))}
                  {d.stock.length === 0 && (
                    <tr>
                      <td colSpan={showSiteColumn ? 4 : 3} className="px-4 py-6 text-center text-slate-500">
                        No unused vouchers on any router. Generate vouchers to start selling.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
