import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthProvider';
import { PageHeader } from '../components/PageHeader';
import { HotspotSnapshot, SetupScriptCard } from '../components/RouterSetup';
import { TunnelServerCard, useTunnelServer } from '../components/TunnelServer';
import { Alert, Badge, Button, Card, Spinner, TextInput } from '../components/ui';
import { friendlyError } from '../lib/errors';
import { formatJubaTime, timeAgo } from '../lib/format';
import { invokeFunction } from '../lib/functions';
import { waitForJob } from '../lib/jobs';
import { useRouters, useSites } from '../lib/queries';
import { routerStatus } from '../lib/routers';
import { supabase } from '../lib/supabase';
import type { RouterInfo, SiteRow, TestConnectionResult } from '../lib/types';

function StatusLine({ router }: { router: RouterInfo }) {
  const status = routerStatus(router);
  if (status === 'online')
    return (
      <span className="flex items-center gap-2">
        <Badge color="green">Online</Badge>
        <span className="text-sm text-slate-500">seen {timeAgo(router.last_seen_at)}</span>
      </span>
    );
  if (status === 'offline')
    return (
      <span className="flex flex-wrap items-center gap-2">
        <Badge color="red">Offline</Badge>
        <span className="text-sm text-slate-600">
          {router.last_seen_at ? `last call ${formatJubaTime(router.last_seen_at)}` : 'never called in'}
        </span>
      </span>
    );
  return <Badge color="gray">{router.last_seen_at ? 'Checking…' : 'Waiting for router'}</Badge>;
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
  const remove = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('routers').delete().eq('id', router.id);
      if (error) {
        if (error.code === '23503') throw new Error(`${router.name} has vouchers or sales and cannot be removed.`);
        throw new Error(friendlyError(error));
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['routers'] }),
  });

  const [script, setScript] = useState<string | null>(null);
  const [showHotspot, setShowHotspot] = useState(false);
  const direct = router.connection === 'direct';
  const tunnel = router.connection === 'tunnel';
  const cloud = router.connection === 'cloud';
  const tunnelServer = useTunnelServer();
  const setup = useMutation({
    mutationFn: () => invokeFunction<{ script: string }>('add-router', { action: 'setup', router_id: router.id }),
    onSuccess: (data) => setScript(data.script),
  });
  function showSetup() {
    const replaces = router.last_seen_at
      ? tunnel
        ? `This makes a new tunnel script for ${router.name} with a new key. The tunnel stops working until you paste the new script. Continue?`
        : `This makes a new setup script for ${router.name}. The connector already on the router stops working until you paste the new script. Continue?`
      : null;
    if (!replaces || window.confirm(replaces)) setup.mutate();
  }

  const testing = test?.phase === 'running';
  const status = routerStatus(router);
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-bold text-slate-900">{router.name}</h2>
          <p className="text-sm text-slate-600">{siteName}</p>
        </div>
        <StatusLine router={router} />
      </div>

      <dl className="mt-4 grid grid-cols-1 gap-x-4 gap-y-2 text-sm min-[420px]:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-slate-500">Connection</dt>
          <dd className="break-all font-medium">
            {direct
              ? `${router.host ?? '?'}:${router.port ?? ''} · ${router.username ?? ''}`
              : tunnel
                ? `tunnel ${router.tunnel_ip ?? '?'}:${router.port ?? ''} · ${router.username ?? ''} · no scheduler`
                : `${router.host ? `${router.host} · ` : ''}connected by script (scheduler)`}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">Hotspot users</dt>
          <dd className="font-medium">
            {router.hotspot_users
              ? `${router.hotspot_users.total} · ${router.hotspot_users.unused} unused · ${router.hotspot_users.used} used`
              : '—'}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">Users report</dt>
          <dd className="font-medium">{router.last_usage_at ? timeAgo(router.last_usage_at) : '—'}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Hotspot</dt>
          <dd className="font-medium">{router.hotspot_server ?? 'read at first check'}</dd>
        </div>
        <div>
          <dt className="text-slate-500">DNS name</dt>
          <dd className="break-all font-medium">{router.dns_name ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Model · RouterOS</dt>
          <dd className="font-medium">
            {router.model ?? '—'} · {router.ros_version ?? '—'}
          </dd>
        </div>
      </dl>

      {!direct && router.status === 'pending' && !router.last_seen_at && !script && (
        <div className="mt-3">
          <Alert tone="info">
            {tunnel
              ? 'This router is not connected through the tunnel yet. Click “Tunnel script” and paste it into the router’s terminal (Winbox → New Terminal).'
              : 'This router has not called in yet. Click “Setup script” and paste it into the router’s terminal (Winbox → New Terminal).'}
          </Alert>
        </div>
      )}
      {cloud && tunnelServer.data?.ready && (
        <div className="mt-3">
          <Alert tone="info">
            This router uses the <code>hzc-cloud</code> scheduler. Your tunnel server is ready:{' '}
            <Link to={`/routers/${router.id}/edit?tunnel=1`} className="font-semibold underline">
              switch it to the tunnel
            </Link>{' '}
            so nothing is scheduled on the router.
          </Alert>
        </div>
      )}
      {status === 'offline' && !router.last_error && (
        <div className="mt-3">
          <Alert tone="warning">
            {direct
              ? 'The router has not answered for a while. Check that it is switched on, has internet, and is reachable at its address.'
              : tunnel
                ? 'The router does not answer through the tunnel. Check that it is switched on and has internet, and that the tunnel server is running.'
                : 'The router stopped calling in. Check that it is switched on and has internet. If it was reset or updated, paste its setup script again.'}
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
      {remove.error && (
        <div className="mt-3">
          <Alert tone="error">{remove.error.message}</Alert>
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {router.hotspot_info && (
          <Button variant="secondary" onClick={() => setShowHotspot((v) => !v)}>
            {showHotspot ? 'Hide hotspot setup' : 'Hotspot setup'}
          </Button>
        )}
        {!direct && (
          <Button variant="secondary" onClick={showSetup} disabled={setup.isPending}>
            {setup.isPending ? <Spinner /> : null} {tunnel ? 'Tunnel script' : 'Setup script'}
          </Button>
        )}
        <Button variant="secondary" onClick={() => onTest(router)} disabled={testing || (cloud && router.status === 'pending')}>
          {testing ? (
            <>
              <Spinner /> Testing…
            </>
          ) : (
            'Test again'
          )}
        </Button>
        <Link
          to={`/routers/${router.id}/edit`}
          className="inline-flex min-h-11 items-center rounded-xl px-4 font-semibold text-slate-800 ring-1 ring-slate-300 hover:bg-slate-50"
        >
          Edit
        </Link>
        <Button
          variant="danger"
          disabled={remove.isPending}
          onClick={() => {
            if (window.confirm(`Remove router ${router.name}? This cannot be undone.`)) remove.mutate();
          }}
        >
          Remove
        </Button>
      </div>
    </Card>
  );
}

function SitesPanel() {
  const sites = useSites();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const add = useMutation({
    mutationFn: async (siteName: string) => {
      const { error } = await supabase.from('sites').insert({ name: siteName });
      if (error) throw new Error(error.code === '23505' ? `A site named "${siteName}" already exists.` : friendlyError(error));
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
      <h2 className="text-lg font-bold">Sites</h2>
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
              Sell on first login
            </label>
          </li>
        ))}
      </ul>
      <p className="mt-1 text-xs text-slate-500">
        Sell on first login: when an unused card logs in for the first time, a cash sale is recorded automatically at the plan price, with no seller. Leave it off to record
        pre-printed cards with “Mark as sold”.
      </p>
      {toggle.error && (
        <div className="mt-2">
          <Alert tone="error">{toggle.error.message}</Alert>
        </div>
      )}
      <form onSubmit={submit} className="mt-3 flex gap-2">
        <TextInput placeholder="New site name, e.g. Jebel Iraq" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
        <Button type="submit" variant="secondary" disabled={!name.trim() || add.isPending}>
          Add
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
          ? [`Connected. ${result.model ?? ''} · RouterOS ${result.ros_version ?? '?'} · up ${result.uptime ?? '?'}`, ...(result.warnings ?? [])].join(' ')
          : (result.error ?? 'The test failed.');
      setTests((t) => ({ ...t, [router.id]: { routerId: router.id, phase: 'done', ok: job.status === 'done', message } }));
    } catch (err) {
      setTests((t) => ({ ...t, [router.id]: { routerId: router.id, phase: 'done', ok: false, message: friendlyError(err) } }));
    } finally {
      void queryClient.invalidateQueries({ queryKey: ['routers'] });
    }
  }

  const siteName = (id: string) => sites.data?.find((s) => s.id === id)?.name ?? 'Unknown site';

  return (
    <div className="space-y-4">
      <PageHeader
        title="Routers"
        subtitle="MikroTik routers, reached at a public IP, through your tunnel server, or calling Hotzonex Cloud by themselves"
        actions={
          <Link
            to="/routers/new"
            className="inline-flex min-h-11 items-center rounded-xl bg-brand-600 px-4 font-semibold text-white hover:bg-brand-700"
          >
            + Add router
          </Link>
        }
      />

      <TunnelServerCard />
      {routers.isLoading && <Spinner className="h-8 w-8 text-brand-600" />}
      {routers.error && <Alert tone="error">{friendlyError(routers.error)}</Alert>}
      {routers.data?.length === 0 && (
        <Card>
          <p className="text-slate-600">No routers yet. Click “Add router” to connect the first one.</p>
        </Card>
      )}
      {routers.data?.map((r) => (
        <RouterCard key={r.id} router={r} siteName={siteName(r.site_id)} test={tests[r.id] ?? null} onTest={testAgain} />
      ))}

      <SitesPanel />
    </div>
  );
}
