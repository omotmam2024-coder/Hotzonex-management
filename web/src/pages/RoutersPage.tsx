import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthProvider';
import { PageHeader } from '../components/PageHeader';
import { Alert, Badge, Button, Card, Spinner, TextInput } from '../components/ui';
import { friendlyError } from '../lib/errors';
import { bareIp, formatJubaTime, timeAgo } from '../lib/format';
import { waitForJob } from '../lib/jobs';
import { useSites } from '../lib/queries';
import { supabase } from '../lib/supabase';
import { ROUTER_COLUMNS, type RouterInfo, type TestConnectionResult } from '../lib/types';

function useRouters() {
  return useQuery({
    queryKey: ['routers'],
    queryFn: async (): Promise<RouterInfo[]> => {
      const { data, error } = await supabase.from('routers').select(ROUTER_COLUMNS).order('name');
      if (error) throw new Error(error.message);
      return (data ?? []) as RouterInfo[];
    },
    // The agent updates status every 60 s; refresh the list often enough to notice.
    refetchInterval: 15_000,
  });
}

function StatusLine({ router }: { router: RouterInfo }) {
  if (router.status === 'online')
    return (
      <span className="flex items-center gap-2">
        <Badge color="green">Online</Badge>
        <span className="text-sm text-slate-500">seen {timeAgo(router.last_seen_at)}</span>
      </span>
    );
  if (router.status === 'offline')
    return (
      <span className="flex flex-wrap items-center gap-2">
        <Badge color="red">Offline</Badge>
        <span className="text-sm text-slate-600">
          {router.last_seen_at ? `since ${formatJubaTime(router.last_seen_at)}` : 'never reached'}
        </span>
      </span>
    );
  return <Badge color="gray">Testing…</Badge>;
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

  const testing = test?.phase === 'running';
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
          <dt className="text-slate-500">Address</dt>
          <dd className="break-all font-mono font-medium">
            {router.use_https ? 'https' : 'http'}://{bareIp(router.ip_address)}:{router.port}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">Hotspot</dt>
          <dd className="font-medium">{router.hotspot_server}</dd>
        </div>
        <div>
          <dt className="text-slate-500">DNS name</dt>
          <dd className="break-all font-medium">{router.dns_name}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Model · RouterOS</dt>
          <dd className="font-medium">
            {router.model ?? '—'} · {router.ros_version ?? '—'}
          </dd>
        </div>
      </dl>

      {router.status === 'offline' && router.last_error && (
        <div className="mt-3">
          <Alert tone="error">{router.last_error}</Alert>
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
        <Button variant="secondary" onClick={() => onTest(router)} disabled={testing || router.status === 'pending'}>
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

  function submit(e: FormEvent) {
    e.preventDefault();
    if (name.trim()) add.mutate(name.trim());
  }

  return (
    <Card>
      <h2 className="text-lg font-bold">Sites</h2>
      <ul className="mt-2 flex flex-wrap gap-2">
        {(sites.data ?? []).map((s) => (
          <li key={s.id}>
            <Badge color="blue">{s.name}</Badge>
          </li>
        ))}
      </ul>
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
  const routers = useRouters();
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
        subtitle="MikroTik routers reached by the Router Agent on the local network"
        actions={
          <Link
            to="/routers/new"
            className="inline-flex min-h-11 items-center rounded-xl bg-brand-600 px-4 font-semibold text-white hover:bg-brand-700"
          >
            + Add router
          </Link>
        }
      />

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
