import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthProvider';
import { PageHeader } from '../components/PageHeader';
import { RevenueChart, type DayRevenue } from '../components/RevenueChart';
import { Alert, Card, Select, Spinner } from '../components/ui';
import { friendlyError } from '../lib/errors';
import { formatNumber, formatSSP } from '../lib/format';
import { useSites } from '../lib/queries';
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
  last_14_days: DayRevenue[];
  stock: StockRow[];
}

const SITE_KEY = 'hzc.dashboardSite';
const LOW_STOCK = 20;

function StatCard({ label, value, sub, to }: { label: string; value: string; sub: string; to?: string }) {
  const body = (
    <Card className="h-full">
      <div className="text-sm font-medium text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-extrabold tabular-nums text-slate-900 sm:text-3xl">{value}</div>
      <div className="mt-1 text-sm text-slate-500">{sub}</div>
    </Card>
  );
  return to ? (
    <Link to={to} className="block rounded-2xl focus:outline-none focus:ring-2 focus:ring-brand-500">
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
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Today" value={formatSSP(d.today.revenue)} sub={`${formatNumber(d.today.sold)} vouchers`} to="/reports?tab=day" />
            <StatCard label="This week" value={formatSSP(d.week.revenue)} sub={`${formatNumber(d.week.sold)} vouchers · from Mon`} to="/reports?tab=week" />
            <StatCard label="This month" value={formatSSP(d.month.revenue)} sub={`${formatNumber(d.month.sold)} vouchers`} to="/reports?tab=month" />
            <StatCard label="Online now" value={formatNumber(d.online_now)} sub="users connected" to="/active-users" />
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
