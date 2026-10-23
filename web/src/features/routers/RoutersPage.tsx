import { useState, type FormEvent } from 'react';
import { ForceRemove } from '../../components/ForceRemove';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../auth/AuthProvider';
import { PageHeader } from '../../components/PageHeader';
import { RouterHealth } from '../../components/RouterHealth';
import { HotspotSnapshot, rich, SetupScriptCard } from '../../components/RouterSetup';
import { useT } from '../../i18n';
import { TunnelServerCard } from '../../components/TunnelServer';
import { useTunnelServer } from '../../hooks/useTunnelServer';
import { Alert, Badge, Button, buttonClass, Card, Spinner, TextInput } from '../../components/ui';
import { friendlyError } from '../../lib/errors';
import { formatJubaTime, formatNumber, timeAgo } from '../../lib/format';
import { invokeFunction } from '../../lib/functions';
import { waitForJob } from '../../lib/jobs';
import { useRouters, useSites } from '../../hooks/queries';
import { routerStatus } from '../../lib/routers';
import { supabase } from '../../lib/supabase';
import type { RouterInfo, SiteRow, TestConnectionResult } from '../../lib/types';

/** The router's state in big words: is it working right now? */
function StatusPanel({ router }: { router: RouterInfo }) {
  const { t } = useT();
  const status = routerStatus(router);
  let tone = 'bg-slate-50 text-slate-700 ring-slate-200';
  let dot = 'bg-slate-400';
  let title = router.last_seen_at ? t('routers.checking') : t('common.waitingRouter');
  let text = '';
  if (status === 'online') {
    tone = 'bg-green-50 text-green-800 ring-green-200';
    dot = 'bg-green-500';
    title = t('routers.big.online');
    text = t('routers.seen', { ago: timeAgo(router.last_seen_at) });
  } else if (status === 'offline') {
    tone = 'bg-red-50 text-red-800 ring-red-200';
    dot = 'bg-red-500';
    title = t('routers.big.offline');
    text = router.last_seen_at ? t('routers.lastCall', { time: formatJubaTime(router.last_seen_at) }) : t('routers.neverCalled');
  }
  return (
    <div className={`flex items-center gap-3 rounded-2xl p-3 ring-1 ${tone}`}>
      <span className={`h-4 w-4 shrink-0 rounded-full ${dot}`} />
      <div className="min-w-0">
        <div className="text-xl font-extrabold">{title}</div>
        {text && <div className="text-sm">{text}</div>}
      </div>
    </div>
  );
}

type TestState = { routerId: string; phase: 'running' } | { routerId: string; phase: 'done'; ok: boolean; message: string };

function RouterCard({
  router,
  siteName,
  test,
  onTest,
}: {
  router: RouterInfo;
  siteName: string;
  test: TestState | null;
  onTest: (r: RouterInfo) => void;
}) {
  const queryClient = useQueryClient();
  const { t } = useT();
  const remove = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('routers').delete().eq('id', router.id);
      if (error) {
        // The database explains why (vouchers or activated vouchers in the sales history).
        if (error.code === '23503') throw new Error(error.message || t('routers.hasSales', { name: router.name }));
        throw new Error(friendlyError(error));
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['routers'] }),
  });

  const [forcing, setForcing] = useState(false);
  const [script, setScript] = useState<string | null>(null);
  const [showHotspot, setShowHotspot] = useState(false);
  const direct = router.connection === 'direct';
  const tunnel = router.connection === 'tunnel';
  const cloud = router.connection === 'cloud';
  const tunnelServer = useTunnelServer();
  const setup = useMutation({
    // Tunnel routers get the same script every time (their key is kept), so it is always safe to show.
    mutationFn: () => invokeFunction<{ script: string }>('add-router', { action: 'setup', router_id: router.id }),
    onSuccess: (data) => setScript(data.script),
  });
  function showSetup() {
    const replaces =
      router.last_seen_at && !tunnel
        ? t('routers.confirm.newScript', { name: router.name })
        : null;
    if (!replaces || window.confirm(replaces)) setup.mutate();
  }

  const testing = test?.phase === 'running';
  const status = routerStatus(router);
  const needsScript = !direct && router.status === 'pending';
  return (
    <Card>
      <div className="min-w-0">
        <h2 className="truncate text-lg font-bold text-slate-900">{router.name}</h2>
        <p className="text-sm text-slate-600">{siteName}</p>
      </div>
      <div className="mt-3">
        <StatusPanel router={router} />
      </div>
      {router.hotspot_users && (
        <p className="mt-3 text-slate-800">
          {t('routers.big.cards', { unused: formatNumber(router.hotspot_users.unused), used: formatNumber(router.hotspot_users.used) })}
        </p>
      )}

      {!direct && router.status === 'pending' && !router.last_seen_at && !script && (
        <div className="mt-3">
          <Alert tone="info">
            {tunnel ? t('routers.pending.tunnel') : t('routers.pending.cloud')}
          </Alert>
        </div>
      )}
      {/* Script routers, and routers saved the old direct way, move to the tunnel. */}
      {(cloud || direct) && tunnelServer.data?.ready && (
        <div className="mt-3">
          <Alert tone="info">
            {rich(t('routers.cloudSwitch'), {
              sched: <code dir="ltr">hzc-cloud</code>,
              link: (
                <Link to={`/routers/${router.id}/edit?tunnel=1`} className="font-semibold underline">
                  {t('routers.cloudSwitch.link')}
                </Link>
              ),
            })}
          </Alert>
        </div>
      )}
      {status === 'offline' && !router.last_error && (
        <div className="mt-3">
          <Alert tone="warning">
            {direct ? t('routers.offline.direct') : tunnel ? t('routers.offline.tunnel') : t('routers.offline.cloud')}
          </Alert>
        </div>
      )}
      {router.last_error && (
        <div className="mt-3">
          <Alert tone="error">{router.last_error}</Alert>
        </div>
      )}
      {setup.error && (
        <div className="mt-3">
          <Alert tone="error">{friendlyError(setup.error)}</Alert>
        </div>
      )}
      {script && (
        <div className="mt-3">
          <SetupScriptCard script={script} kind={tunnel ? 'tunnel' : 'cloud'} />
        </div>
      )}
      {showHotspot && router.hotspot_info && (
        <div className="mt-3 rounded-xl bg-slate-50 p-3">
          <HotspotSnapshot info={router.hotspot_info} hotspotServer={router.hotspot_server} />
        </div>
      )}
      {test?.phase === 'done' && (
        <div className="mt-3">
          <Alert tone={test.ok ? 'success' : 'error'}>{test.message}</Alert>
        </div>
      )}
      {remove.error && !forcing && (
        <div className="mt-3 space-y-2">
          <Alert tone="error">{remove.error.message}</Alert>
          <Button variant="danger" onClick={() => setForcing(true)}>
            {t('force.openRouter')}
          </Button>
        </div>
      )}
      {forcing && <ForceRemove kind="router" id={router.id} name={router.name} onClose={() => setForcing(false)} onDone={() => setForcing(false)} />}

      <div className="mt-4 flex flex-wrap gap-2">
        {/* A new router still needs its script: that is the one thing to do, so it comes first. */}
        {needsScript && (
          <Button onClick={showSetup} disabled={setup.isPending}>
            {setup.isPending ? <Spinner /> : null} {tunnel ? t('routers.tunnelScript') : t('routers.setupScript')}
          </Button>
        )}
        <Button variant="secondary" onClick={() => onTest(router)} disabled={testing || (cloud && router.status === 'pending')}>
          {testing ? (
            <>
              <Spinner /> {t('routers.testing')}
            </>
          ) : (
            t('routers.testAgain')
          )}
        </Button>
        <Link to={`/routers/${router.id}/edit`} className={buttonClass('secondary')}>
          {t('common.edit')}
        </Link>
      </div>

      {/* Technical details and rarely used buttons: there when needed, out of the way otherwise. */}
      <details className="mt-3 rounded-xl bg-slate-50 px-3">
        <summary className="flex min-h-11 cursor-pointer items-center font-semibold text-slate-700">{t('routers.more')}</summary>
        <div className="space-y-3 pb-3">
          <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-sm min-[420px]:grid-cols-2 lg:grid-cols-4">
            <div>
              <dt className="text-slate-500">{t('routers.connection')}</dt>
              <dd className="break-all font-medium">
                {direct
                  ? `${router.host ?? '?'}:${router.port ?? ''} · ${router.username ?? ''}`
                  : tunnel
                    ? t('routers.conn.tunnel', { address: `${router.tunnel_ip ?? '?'}:${router.port ?? ''}`, user: router.username ?? '' })
                    : `${router.host ? `${router.host} · ` : ''}${t('routers.conn.cloud')}`}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">{t('routers.hotspotUsers')}</dt>
              <dd className="font-medium">
                {router.hotspot_users
                  ? t('routers.usersCount', { total: router.hotspot_users.total, unused: router.hotspot_users.unused, used: router.hotspot_users.used })
                  : '—'}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">{t('routers.usersReport')}</dt>
              <dd className="font-medium">{router.last_usage_at ? timeAgo(router.last_usage_at) : '—'}</dd>
            </div>
            <div>
              <dt className="text-slate-500">{t('routers.hotspot')}</dt>
              <dd className="font-medium">{router.hotspot_server ?? t('routers.readAtFirstCheck')}</dd>
            </div>
            <div>
              <dt className="text-slate-500">{t('routers.dnsName')}</dt>
              <dd className="break-all font-medium">{router.dns_name ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-slate-500">{t('routers.modelRos')}</dt>
              <dd className="font-medium">
                {router.model ?? '—'} · {router.ros_version ?? '—'}
              </dd>
            </div>
          </dl>
          {router.status !== 'pending' && (
            <div className="rounded-xl bg-white p-3">
              <h3 className="mb-2 text-sm font-bold text-slate-700">{t('routers.health')}</h3>
              <RouterHealth router={router} />
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {router.hotspot_info && (
              <Button variant="secondary" onClick={() => setShowHotspot((v) => !v)}>
                {showHotspot ? t('routers.hideHotspotSetup') : t('routers.hotspotSetup')}
              </Button>
            )}
            {!direct && !needsScript && (
              <Button variant="secondary" onClick={showSetup} disabled={setup.isPending}>
                {setup.isPending ? <Spinner /> : null} {tunnel ? t('routers.tunnelScript') : t('routers.setupScript')}
              </Button>
            )}
            <Button
              variant="danger"
              disabled={remove.isPending}
              onClick={() => {
                if (window.confirm(t('routers.confirm.remove', { name: router.name }))) remove.mutate();
              }}
            >
              {t('common.remove')}
            </Button>
          </div>
        </div>
      </details>
    </Card>
  );
}

function SitesPanel() {
  const sites = useSites();
  const queryClient = useQueryClient();
  const { t } = useT();
  const [name, setName] = useState('');
  const add = useMutation({
    mutationFn: async (siteName: string) => {
      const { error } = await supabase.from('sites').insert({ name: siteName });
      if (error) throw new Error(error.code === '23505' ? t('routers.siteExists', { name: siteName }) : friendlyError(error));
    },
    onSuccess: () => {
      setName('');
      void queryClient.invalidateQueries({ queryKey: ['sites'] });
    },
  });

  const toggle = useMutation({
    mutationFn: async ({ id, value }: { id: string; value: boolean }) => {
      const { error } = await supabase.from('sites').update({ auto_sale_on_login: value }).eq('id', id);
      if (error) throw new Error(friendlyError(error));
    },
    // Show the new setting straight away; roll back if saving fails.
    onMutate: async ({ id, value }) => {
      await queryClient.cancelQueries({ queryKey: ['sites'] });
      const previous = queryClient.getQueryData<SiteRow[]>(['sites']);
      queryClient.setQueryData<SiteRow[]>(['sites'], (old) => old?.map((s) => (s.id === id ? { ...s, auto_sale_on_login: value } : s)));
      return { previous };
    },
    onError: (_err, _vars, context) => queryClient.setQueryData(['sites'], context?.previous),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['sites'] }),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (name.trim()) add.mutate(name.trim());
  }

  return (
    <Card>
      <h2 className="text-lg font-bold">{t('routers.sites')}</h2>
      <ul className="mt-2 divide-y divide-slate-100">
        {(sites.data ?? []).map((s) => (
          <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <Badge color="blue">{s.name}</Badge>
            <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                className="h-5 w-5"
                checked={s.auto_sale_on_login}
                disabled={toggle.isPending}
                onChange={(e) => toggle.mutate({ id: s.id, value: e.target.checked })}
              />
              {t('routers.sellFirstLogin')}
            </label>
          </li>
        ))}
      </ul>
      <p className="mt-1 text-xs text-slate-500">{t('routers.sellFirstLoginHelp')}</p>
      {toggle.error && (
        <div className="mt-2">
          <Alert tone="error">{toggle.error.message}</Alert>
        </div>
      )}
      <form onSubmit={submit} className="mt-3 flex gap-2">
        <TextInput placeholder={t('routers.newSitePlaceholder')} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
        <Button type="submit" variant="secondary" disabled={!name.trim() || add.isPending}>
          {t('common.add')}
        </Button>
      </form>
      {add.error && (
        <div className="mt-2">
          <Alert tone="error">{add.error.message}</Alert>
        </div>
      )}
    </Card>
  );
}

export function RoutersPage() {
  const { profile } = useAuth();
  // Routers call in every 30 s; refresh often enough to notice.
  const routers = useRouters(10_000);
  const sites = useSites();
  const queryClient = useQueryClient();
  const [tests, setTests] = useState<Record<string, TestState>>({});
  const { t } = useT();

  async function testAgain(router: RouterInfo) {
    setTests((t) => ({ ...t, [router.id]: { routerId: router.id, phase: 'running' } }));
    try {
      const { data, error } = await supabase
        .from('router_jobs')
        .insert({ router_id: router.id, type: 'test_connection', payload: { mode: 'retest' }, created_by: profile?.id })
        .select('id')
        .single();
      if (error) throw new Error(friendlyError(error));
      const job = await waitForJob(data.id);
      const result = (job.result ?? {}) as TestConnectionResult;
      const message =
        job.status === 'done'
          ? [t('routers.testConnected', { model: result.model ?? '', ros: result.ros_version ?? '?', uptime: result.uptime ?? '?' }), ...(result.warnings ?? [])].join(' ')
          : (result.error ?? t('routers.testFailed'));
      setTests((t) => ({ ...t, [router.id]: { routerId: router.id, phase: 'done', ok: job.status === 'done', message } }));
    } catch (err) {
      setTests((t) => ({ ...t, [router.id]: { routerId: router.id, phase: 'done', ok: false, message: friendlyError(err) } }));
    } finally {
      void queryClient.invalidateQueries({ queryKey: ['routers'] });
    }
  }

  const siteName = (id: string) => sites.data?.find((s) => s.id === id)?.name ?? t('common.unknownSite');

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('nav.routers')}
        subtitle={t('routers.subtitle')}
        actions={
          <Link
            to="/routers/new"
            className="inline-flex min-h-11 items-center rounded-xl bg-brand-600 px-4 font-semibold text-white hover:bg-brand-700"
          >
            {t('routers.addRouter')}
          </Link>
        }
      />

      <TunnelServerCard />
      {routers.isLoading && <Spinner className="h-8 w-8 text-brand-600" />}
      {routers.error && <Alert tone="error">{friendlyError(routers.error)}</Alert>}
      {routers.data?.length === 0 && (
        <Card>
          <p className="text-slate-600">{t('routers.empty')}</p>
        </Card>
      )}
      {routers.data?.map((r) => (
        <RouterCard key={r.id} router={r} siteName={siteName(r.site_id)} test={tests[r.id] ?? null} onTest={testAgain} />
      ))}

      <SitesPanel />
    </div>
  );
}
