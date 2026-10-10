import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthProvider';
import { PageHeader } from '../components/PageHeader';
import { Alert, Badge, Card, Spinner } from '../components/ui';
import { friendlyError } from '../lib/errors';
import { bareIp, formatBytes, formatDuration, formatJubaTime, formatNumber, timeAgo } from '../lib/format';
import { waitForJob } from '../lib/jobs';
import { usePlans, useRouters } from '../lib/queries';
import { supabase } from '../lib/supabase';

interface SessionRow {
  id: string;
  router_id: string;
  voucher_id: string | null;
  code: string;
  mac_address: string;
  ip_address: string | null;
  uptime_seconds: number;
  bytes_in: number;
  bytes_out: number;
  updated_at: string;
  vouchers: { plan_id: string; status: string; uptime_used_seconds: number; bytes_used: number; expires_at: string | null } | null;
}

type DisconnectState = { phase: 'running' } | { phase: 'done'; ok: boolean; message: string };

export function ActiveUsersPage() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const queryClient = useQueryClient();
  const routers = useRouters(30_000);
  const plans = usePlans();
  const [routerFilter, setRouterFilter] = useState('');
  const [disconnects, setDisconnects] = useState<Record<string, DisconnectState>>({});
  // The row disappears once the user is gone, so confirm at page level.
  const [notice, setNotice] = useState<string | null>(null);

  const sessions = useQuery({
    queryKey: ['active-sessions'],
    refetchInterval: 30_000,
    queryFn: async (): Promise<SessionRow[]> => {
      const { data, error } = await supabase
        .from('active_sessions')
        .select('id, router_id, voucher_id, code, mac_address, ip_address, uptime_seconds, bytes_in, bytes_out, updated_at, vouchers(plan_id, status, uptime_used_seconds, bytes_used, expires_at)')
        .order('uptime_seconds', { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as SessionRow[];
    },
  });

  // Live updates: the agent rewrites active_sessions every 60 s.
  useEffect(() => {
    const channel = supabase
      .channel('active-sessions')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'active_sessions' }, () => {
        void queryClient.invalidateQueries({ queryKey: ['active-sessions'] });
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [queryClient]);

  async function disconnect(s: SessionRow) {
    if (!window.confirm(`Disconnect ${s.code} (${s.mac_address || 'all devices'})?`)) return;
    setDisconnects((d) => ({ ...d, [s.id]: { phase: 'running' } }));
    try {
      const { data, error } = await supabase
        .from('router_jobs')
        .insert({ router_id: s.router_id, type: 'disconnect_user', payload: { code: s.code, mac_address: s.mac_address }, created_by: profile?.id })
        .select('id')
        .single();
      if (error) throw new Error(friendlyError(error));
      const job = await waitForJob(data.id, 30_000);
      const ok = job.status === 'done';
      if (ok) setNotice(`${s.code} was disconnected.`);
      setDisconnects((d) => ({
        ...d,
        [s.id]: { phase: 'done', ok, message: ok ? 'Disconnected.' : String((job.result as { error?: string } | null)?.error ?? 'Could not disconnect.') },
      }));
      void queryClient.invalidateQueries({ queryKey: ['active-sessions'] });
    } catch (err) {
      setDisconnects((d) => ({ ...d, [s.id]: { phase: 'done', ok: false, message: friendlyError(err) } }));
    }
  }

  const planById = new Map((plans.data ?? []).map((p) => [p.id, p]));
  const list = (sessions.data ?? []).filter((s) => !routerFilter || s.router_id === routerFilter);
  const visibleRouters = (routers.data ?? []).filter((r) => r.status !== 'pending' && (!routerFilter || r.id === routerFilter));

  return (
    <div className="space-y-4">
      <PageHeader title="Active users" subtitle="Who is online now. Updated by the Router Agent every minute." />

      <div className="flex flex-wrap items-center gap-2">
        <Card className="!py-3">
          <span className="text-sm text-slate-500">Online now</span>{' '}
          <span className="text-2xl font-extrabold tabular-nums">{formatNumber(list.length)}</span>
        </Card>
        {(routers.data ?? []).filter((r) => r.status !== 'pending').length > 1 &&
          [{ id: '', name: 'All routers' }, ...(routers.data ?? []).filter((r) => r.status !== 'pending')].map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setRouterFilter(r.id)}
              className={`min-h-11 rounded-xl px-4 font-semibold ring-1 ${routerFilter === r.id ? 'bg-brand-600 text-white ring-brand-600' : 'bg-white text-slate-700 ring-slate-300'}`}
            >
              {r.name}
            </button>
          ))}
      </div>

      {notice && <Alert tone="success">{notice}</Alert>}
      {sessions.error && <Alert tone="error">{friendlyError(sessions.error)}</Alert>}
      {sessions.isLoading && <Spinner className="h-8 w-8 text-brand-600" />}

      {visibleRouters.map((router) => {
        const rows = list.filter((s) => s.router_id === router.id);
        const lastUpdate = rows.reduce<string | null>((m, s) => (!m || s.updated_at > m ? s.updated_at : m), null);
        return (
          <Card key={router.id} className="!p-0">
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold">{router.name}</h2>
                <Badge color={router.status === 'online' ? 'green' : 'red'}>{router.status === 'online' ? 'Online' : 'Offline'}</Badge>
                <span className="text-sm text-slate-500">{formatNumber(rows.length)} online</span>
              </div>
              <span className="text-xs text-slate-500">
                {router.status === 'offline'
                  ? `Router offline${router.last_seen_at ? ` since ${formatJubaTime(router.last_seen_at)}` : ''} — live users unknown`
                  : lastUpdate
                    ? `Updated ${timeAgo(lastUpdate)}`
                    : ''}
              </span>
            </div>
            {rows.length === 0 ? (
              <p className="border-t border-slate-100 px-4 py-4 text-slate-500">{router.status === 'online' ? 'Nobody is online.' : '—'}</p>
            ) : (
              <>
              {/* Phones: one card per user */}
              <ul className="divide-y divide-slate-100 border-t border-slate-100 sm:hidden">
                {rows.map((s) => {
                  const plan = s.vouchers ? planById.get(s.vouchers.plan_id) : undefined;
                  const used = Math.max(s.vouchers?.uptime_used_seconds ?? 0, s.uptime_seconds);
                  const dc = disconnects[s.id];
                  return (
                    <li key={s.id} className="px-4 py-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-lg font-semibold tracking-wider">{s.code}</span>
                        <span className="flex items-center gap-2 text-sm">
                          <span className="h-3 w-3 rounded-full" style={{ backgroundColor: plan?.color ?? '#94a3b8' }} />
                          {plan?.name ?? 'Not a Hotzonex voucher'}
                        </span>
                      </div>
                      <div className="mt-1 grid grid-cols-2 gap-x-3 text-sm text-slate-600">
                        <span>
                          Used <strong className="text-slate-900">{formatDuration(used)}</strong>
                          {plan ? ` / ${formatDuration(plan.uptime_seconds)}` : ''}
                        </span>
                        <span>
                          Data <strong className="text-slate-900">{formatBytes(s.bytes_in + s.bytes_out)}</strong>
                        </span>
                        <span className="font-mono text-xs">{s.mac_address || '—'}</span>
                        <span className="text-xs">{s.vouchers?.expires_at ? `Expires ${formatJubaTime(s.vouchers.expires_at)}` : ''}</span>
                      </div>
                      {isAdmin &&
                        (dc?.phase === 'done' && !dc.ok ? (
                          <p className="mt-2 text-sm text-red-700">{dc.message}</p>
                        ) : (
                          <button
                            type="button"
                            disabled={dc?.phase === 'running' || router.status !== 'online'}
                            onClick={() => void disconnect(s)}
                            className="mt-2 inline-flex min-h-11 items-center gap-2 rounded-lg px-3 font-semibold text-red-700 ring-1 ring-red-200 disabled:opacity-50"
                          >
                            {dc?.phase === 'running' && <Spinner className="h-4 w-4" />} Disconnect
                          </button>
                        ))}
                    </li>
                  );
                })}
              </ul>
              <div className="hidden overflow-x-auto border-t border-slate-100 sm:block">
                <table className="w-full min-w-[760px] text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-4 py-2">Code</th>
                      <th className="px-4 py-2">Plan</th>
                      <th className="px-4 py-2">Device</th>
                      <th className="px-4 py-2">This session</th>
                      <th className="px-4 py-2">Time used</th>
                      <th className="px-4 py-2">Data used</th>
                      <th className="px-4 py-2">Expires</th>
                      {isAdmin && (
                        <th className="px-4 py-2">
                          <span className="sr-only">Disconnect</span>
                        </th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((s) => {
                      const plan = s.vouchers ? planById.get(s.vouchers.plan_id) : undefined;
                      const used = Math.max(s.vouchers?.uptime_used_seconds ?? 0, s.uptime_seconds);
                      const dc = disconnects[s.id];
                      return (
                        <tr key={s.id} className="border-t border-slate-100">
                          <td className="px-4 py-2 font-mono text-base font-semibold tracking-wider">{s.code}</td>
                          <td className="whitespace-nowrap px-4 py-2">
                            {plan ? (
                              <span className="flex items-center gap-2">
                                <span className="h-3 w-3 rounded-full" style={{ backgroundColor: plan.color }} />
                                {plan.name}
                              </span>
                            ) : (
                              <span className="text-amber-700">Not a Hotzonex voucher</span>
                            )}
                          </td>
                          <td className="px-4 py-2">
                            <div className="font-mono text-xs">{s.mac_address || '—'}</div>
                            <div className="text-xs text-slate-500">{s.ip_address ? bareIp(s.ip_address) : ''}</div>
                          </td>
                          <td className="px-4 py-2">{formatDuration(s.uptime_seconds)}</td>
                          <td className="whitespace-nowrap px-4 py-2">
                            {formatDuration(used)}
                            {plan && <span className="text-slate-500"> / {formatDuration(plan.uptime_seconds)}</span>}
                          </td>
                          <td className="px-4 py-2">{formatBytes(s.bytes_in + s.bytes_out)}</td>
                          <td className="whitespace-nowrap px-4 py-2">{s.vouchers?.expires_at ? formatJubaTime(s.vouchers.expires_at) : '—'}</td>
                          {isAdmin && (
                            <td className="px-4 py-2 text-right">
                              {dc?.phase === 'done' ? (
                                <span className={`text-sm ${dc.ok ? 'text-green-700' : 'text-red-700'}`}>{dc.message}</span>
                              ) : (
                                <button
                                  type="button"
                                  disabled={dc?.phase === 'running' || router.status !== 'online'}
                                  onClick={() => void disconnect(s)}
                                  className="inline-flex min-h-10 items-center gap-2 rounded-lg px-3 font-semibold text-red-700 ring-1 ring-red-200 hover:bg-red-50 disabled:opacity-50"
                                >
                                  {dc?.phase === 'running' && <Spinner className="h-4 w-4" />} Disconnect
                                </button>
                              )}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              </>
            )}
          </Card>
        );
      })}
    </div>
  );
}
