import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../auth/AuthProvider';
import { PageHeader } from '../../components/PageHeader';
import { Alert, Badge, Button, buttonClass, Card, Field, Select, Spinner, TextInput } from '../../components/ui';
import { friendlyError } from '../../lib/errors';
import { formatDuration, formatJubaTime, formatNumber, formatSSP } from '../../lib/format';
import { invalidateSalesData, usePlans, useRouters, useSites } from '../../hooks/queries';
import { supabase } from '../../lib/supabase';
import { planOnRouter, type BatchStatus } from '../../lib/types';
import { generateVouchersSchema, validate } from '../../lib/validation';

const BATCH_COLUMNS =
  'id, created_at, site_id, router_id, plan_id, quantity, code_length, site_name, router_name, plan_name, plan_color, price_ssp, uptime_seconds, voucher_count, pushed_count, push_status, push_error, push_finished_at, push_warnings';

function isPushing(b: BatchStatus) {
  return b.push_status === 'queued' || b.push_status === 'running';
}

function BatchRow({ batch }: { batch: BatchStatus }) {
  const queryClient = useQueryClient();
  const retry = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('queue_batch_push', { p_batch_id: batch.id });
      if (error) throw new Error(friendlyError(error));
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['batches'] }),
  });

  let status;
  if (isPushing(batch)) {
    status = (
      <span className="flex items-center gap-2 text-brand-700">
        <Spinner className="h-4 w-4" /> Pushing to router… {formatNumber(batch.pushed_count)}/{formatNumber(batch.voucher_count)}
      </span>
    );
  } else if (batch.push_status === 'done') {
    const disabled = batch.voucher_count - batch.pushed_count;
    status = (
      <span className="flex flex-wrap items-center gap-2">
        <Badge color="green">Ready</Badge>
        <span className="text-sm text-slate-600">
          {formatNumber(batch.pushed_count)} on router{disabled > 0 ? ` · ${disabled} disabled (code already used on router)` : ''}
        </span>
      </span>
    );
  } else {
    status = (
      <span className="flex flex-wrap items-center gap-2">
        <Badge color="red">{batch.push_status === 'failed' ? 'Push failed' : 'Not pushed'}</Badge>
        <span className="text-sm text-slate-600">
          {formatNumber(batch.pushed_count)}/{formatNumber(batch.voucher_count)} on router
        </span>
      </span>
    );
  }

  return (
    <li className="flex flex-col gap-2 border-b border-slate-100 py-3 last:border-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <span className="mt-1 h-10 w-2 shrink-0 rounded-full" style={{ backgroundColor: batch.plan_color }} />
        <div className="min-w-0">
          <div className="font-semibold">
            {formatNumber(batch.quantity)} × {batch.plan_name}{' '}
            <span className="font-normal text-slate-500">
              ({formatSSP(batch.price_ssp)} · {formatDuration(batch.uptime_seconds)})
            </span>
          </div>
          <div className="text-sm text-slate-500">
            {batch.router_name} · {batch.site_name} · {formatJubaTime(batch.created_at)}
          </div>
          <div className="mt-1">{status}</div>
          {batch.push_status === 'failed' && batch.push_error && <p className="mt-1 text-sm text-red-700">{batch.push_error}</p>}
          {(batch.push_warnings ?? []).map((w) => (
            <p key={w} className="mt-1 text-sm text-amber-800">
              ⚠ {w}
            </p>
          ))}
          {batch.push_status === 'done' && !(batch.push_warnings ?? []).length && batch.pushed_count > 0 && (
            <p className="mt-1 text-xs text-green-700">Checked on the router ✓</p>
          )}
          {retry.error && <p className="mt-1 text-sm text-red-700">{friendlyError(retry.error)}</p>}
        </div>
      </div>
      <div className="flex shrink-0 gap-2">
        {(batch.push_status === 'failed' || batch.push_status === null) && (
          <Button variant="secondary" onClick={() => retry.mutate()} disabled={retry.isPending}>
            Retry push
          </Button>
        )}
        {batch.pushed_count > 0 && (
          <Link
            to={`/vouchers/print?batch=${batch.id}`}
            className={buttonClass('secondary')}
          >
            Print
          </Link>
        )}
        <Link
          to={`/vouchers?batch=${batch.id}`}
          className={buttonClass('secondary')}
        >
          View codes
        </Link>
      </div>
    </li>
  );
}

export function GenerateVouchersPage() {
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const sites = useSites();
  const routers = useRouters();
  const plans = usePlans();

  const fixedSite = profile?.role === 'manager' ? profile.site_id : null;
  const [siteId, setSiteId] = useState('');
  const [routerId, setRouterId] = useState('');
  const [planId, setPlanId] = useState('');
  const [quantity, setQuantity] = useState('100');
  const [codeLength, setCodeLength] = useState('8');
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (fixedSite) setSiteId(fixedSite);
    else if (!siteId && sites.data?.length === 1) setSiteId(sites.data[0]?.id ?? '');
  }, [fixedSite, siteId, sites.data]);

  const siteRouters = useMemo(() => (routers.data ?? []).filter((r) => r.site_id === siteId && r.status !== 'pending'), [routers.data, siteId]);
  useEffect(() => {
    if (!siteRouters.some((r) => r.id === routerId)) setRouterId(siteRouters.length === 1 ? (siteRouters[0]?.id ?? '') : '');
  }, [siteRouters, routerId]);

  const router = siteRouters.find((r) => r.id === routerId);

  // The router's own cards (MikroTicket's) set the length: its login page is made for that many digits.
  const routerCodeLength = useQuery({
    queryKey: ['router-code-length', routerId],
    enabled: Boolean(routerId),
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<number | null> => {
      const { data, error } = await supabase.from('router_logins').select('username').eq('router_id', routerId).limit(500);
      if (error) throw new Error(friendlyError(error));
      const counts = new Map<number, number>();
      for (const { username } of data ?? []) {
        if (/^[0-9]{6,10}$/.test(username)) counts.set(username.length, (counts.get(username.length) ?? 0) + 1);
      }
      const best = [...counts].sort((a, b) => b[1] - a[1])[0];
      return best && best[1] >= 5 ? best[0] : null;
    },
  });
  const ownLength = routerCodeLength.data ?? null;
  useEffect(() => {
    if (ownLength) setCodeLength(String(ownLength));
  }, [ownLength, routerId]);
  // Only plans ticked for this router (Plans page): its vouchers use the router's own profile for the plan.
  const activePlans = useMemo(() => (plans.data ?? []).filter((p) => p.is_active && (!routerId || planOnRouter(p, routerId))), [plans.data, routerId]);
  useEffect(() => {
    if (planId && !activePlans.some((p) => p.id === planId)) setPlanId('');
  }, [activePlans, planId]);

  const batches = useQuery({
    queryKey: ['batches'],
    queryFn: async (): Promise<BatchStatus[]> => {
      const { data, error } = await supabase.from('voucher_batch_status').select(BATCH_COLUMNS).order('created_at', { ascending: false }).limit(20);
      if (error) throw new Error(friendlyError(error));
      return (data ?? []) as BatchStatus[];
    },
    refetchInterval: (query) => ((query.state.data ?? []).some(isPushing) ? 2000 : 15_000),
  });

  const generate = useMutation({
    mutationFn: async () => {
      const input = validate(generateVouchersSchema, { p_router_id: routerId, p_plan_id: planId, p_quantity: quantity, p_code_length: codeLength });
      if (router?.status === 'offline') {
        throw new Error(
          `Router ${router.name} is offline${router.last_seen_at ? ` since ${formatJubaTime(router.last_seen_at)}` : ''}. Generate vouchers when it is back online.`,
        );
      }
      const { error } = await supabase.rpc('generate_vouchers', input);
      if (error) throw new Error(friendlyError(error));
      return input.p_quantity;
    },
    onSuccess: (qty) => {
      const plan = activePlans.find((p) => p.id === planId);
      setNotice(`${formatNumber(qty)} × ${plan?.name ?? 'vouchers'} created. They can be sold or printed once the batch shows Ready.`);
      invalidateSalesData(queryClient);
    },
  });

  // A double tap must not make two batches: the second tap comes before isPending re-renders.
  const inFlight = useRef(false);
  function submit(e: FormEvent) {
    e.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    setNotice(null);
    generate.mutate(undefined, { onSettled: () => (inFlight.current = false) });
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Generate vouchers"
        subtitle="Codes are numbers only. Customers type just the code to log in."
        actions={
          <Link to="/vouchers" className={buttonClass('secondary')}>
            All vouchers
          </Link>
        }
      />

      <Card className="max-w-3xl">
        <form onSubmit={submit} className="space-y-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Site">
              <Select value={siteId} onChange={(e) => setSiteId(e.target.value)} disabled={Boolean(fixedSite)}>
                <option value="">Choose a site…</option>
                {(sites.data ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Router">
              <Select value={routerId} onChange={(e) => setRouterId(e.target.value)} disabled={!siteId}>
                <option value="">{siteId && siteRouters.length === 0 ? 'No routers at this site' : 'Choose a router…'}</option>
                {siteRouters.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} {r.status === 'offline' ? '(offline)' : ''}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Plan">
              <Select value={planId} onChange={(e) => setPlanId(e.target.value)}>
                <option value="">Choose a plan…</option>
                {activePlans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} — {formatSSP(p.price_ssp)} · {formatDuration(p.uptime_seconds)}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Quantity" hint="1 to 1000">
                <TextInput inputMode="numeric" value={quantity} onChange={(e) => setQuantity(e.target.value.replace(/\D/g, '').slice(0, 4))} />
              </Field>
              <Field label="Code length" hint={ownLength ? `Digits · this router's cards use ${ownLength}` : 'Digits'}>
                <Select value={codeLength} onChange={(e) => setCodeLength(e.target.value)}>
                  {[6, 7, 8, 9, 10].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          </div>

          {ownLength && Number(codeLength) !== ownLength && (
            <Alert tone="warning">
              {router?.name}'s own cards have {ownLength} digits, and its login page is made for that length. Codes of {codeLength} digits may not log in there.
            </Alert>
          )}

          {router?.status === 'offline' && (
            <Alert tone="warning">
              Router {router.name} is offline{router.last_seen_at ? ` since ${formatJubaTime(router.last_seen_at)}` : ''}. Vouchers cannot be pushed until it is back
              online.
            </Alert>
          )}
          {generate.error && <Alert tone="error">{generate.error.message}</Alert>}
          {notice && <Alert tone="success">{notice}</Alert>}

          <Button type="submit" disabled={generate.isPending} className="min-h-12 px-8 text-lg">
            {generate.isPending && <Spinner />} Generate
          </Button>
        </form>
      </Card>

      <Card>
        <h2 className="text-lg font-bold">Recent batches</h2>
        {batches.isLoading && <Spinner className="mt-3 h-6 w-6 text-brand-600" />}
        {batches.error && <Alert tone="error">{friendlyError(batches.error)}</Alert>}
        {batches.data?.length === 0 && <p className="mt-2 text-slate-600">No batches yet.</p>}
        <ul className="mt-1">
          {(batches.data ?? []).map((b) => (
            <BatchRow key={b.id} batch={b} />
          ))}
        </ul>
      </Card>
    </div>
  );
}
