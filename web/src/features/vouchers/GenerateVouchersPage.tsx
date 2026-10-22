import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../auth/AuthProvider';
import { PageHeader } from '../../components/PageHeader';
import { Step } from '../../components/Step';
import { Alert, Badge, Button, buttonClass, Card, Field, Select, Spinner, TextInput } from '../../components/ui';
import { friendlyError } from '../../lib/errors';
import { formatJubaTime, formatNumber, formatSSP } from '../../lib/format';
import { useT } from '../../i18n';
import { durationText } from '../../print/duration';
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
  const { t } = useT();
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
        <Spinner className="h-4 w-4" /> {t('vouchers.gen.pushing', { done: formatNumber(batch.pushed_count), total: formatNumber(batch.voucher_count) })}
      </span>
    );
  } else if (batch.push_status === 'done') {
    const disabled = batch.voucher_count - batch.pushed_count;
    status = (
      <span className="flex flex-wrap items-center gap-2">
        <Badge color="green">{t('vouchers.gen.ready')}</Badge>
        <span className="text-sm text-slate-600">
          {t('vouchers.gen.onRouter', { n: formatNumber(batch.pushed_count) })}
          {disabled > 0 ? ` · ${t('vouchers.gen.disabledUsed', { n: disabled })}` : ''}
        </span>
      </span>
    );
  } else {
    status = (
      <span className="flex flex-wrap items-center gap-2">
        <Badge color="red">{batch.push_status === 'failed' ? t('vouchers.gen.pushFailed') : t('vouchers.gen.notPushed')}</Badge>
        <span className="text-sm text-slate-600">
          {t('vouchers.gen.onRouterOf', { done: formatNumber(batch.pushed_count), total: formatNumber(batch.voucher_count) })}
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
              ({formatSSP(batch.price_ssp)} · {durationText(batch.uptime_seconds)})
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
            <p className="mt-1 text-xs text-green-700">{t('vouchers.gen.checked')}</p>
          )}
          {retry.error && <p className="mt-1 text-sm text-red-700">{friendlyError(retry.error)}</p>}
        </div>
      </div>
      <div className="flex shrink-0 gap-2">
        {(batch.push_status === 'failed' || batch.push_status === null) && (
          <Button variant="secondary" onClick={() => retry.mutate()} disabled={retry.isPending}>
            {t('vouchers.gen.retryPush')}
          </Button>
        )}
        {batch.pushed_count > 0 && (
          <Link
            to={`/vouchers/print?batch=${batch.id}`}
            className={buttonClass('secondary')}
          >
            {t('common.print')}
          </Link>
        )}
        <Link
          to={`/vouchers?batch=${batch.id}`}
          className={buttonClass('secondary')}
        >
          {t('vouchers.gen.viewCodes')}
        </Link>
      </div>
    </li>
  );
}

export function GenerateVouchersPage() {
  const { t } = useT();
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
          router.last_seen_at
            ? t('vouchers.gen.offlineErrSince', { name: router.name, time: formatJubaTime(router.last_seen_at) })
            : t('vouchers.gen.offlineErr', { name: router.name }),
        );
      }
      const { error } = await supabase.rpc('generate_vouchers', input);
      if (error) throw new Error(friendlyError(error));
      return input.p_quantity;
    },
    onSuccess: (qty) => {
      const plan = activePlans.find((p) => p.id === planId);
      setNotice(t('vouchers.gen.created', { n: formatNumber(qty), plan: plan?.name ?? t('vouchers.gen.vouchersWord') }));
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
        title={t('vouchers.gen.title')}
        subtitle={t('vouchers.gen.subtitle')}
        actions={
          <Link to="/vouchers" className={buttonClass('secondary')}>
            {t('vouchers.gen.allVouchers')}
          </Link>
        }
      />

      <Card className="max-w-3xl">
        <form onSubmit={submit} className="space-y-5" noValidate>
          <Step n={1} title={t('vouchers.gen.step.where')}>
            {/* One site or one router: nothing to choose, just say which. */}
            {!fixedSite && (sites.data ?? []).length > 1 && (
              <Field label={t('common.site')}>
                <Select value={siteId} onChange={(e) => setSiteId(e.target.value)}>
                  <option value="">{t('vouchers.gen.chooseSite')}</option>
                  {(sites.data ?? []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            {siteId && siteRouters.length === 0 ? (
              <Alert tone="warning">{t('vouchers.gen.noRouters')}</Alert>
            ) : siteRouters.length === 1 && router ? (
              <p className="rounded-xl bg-slate-50 p-3 font-semibold text-slate-900">
                {router.name} {router.status === 'offline' ? t('vouchers.gen.offlineTag') : ''}
              </p>
            ) : (
              <Field label={t('common.router')}>
                <Select value={routerId} onChange={(e) => setRouterId(e.target.value)} disabled={!siteId}>
                  <option value="">{t('vouchers.gen.chooseRouter')}</option>
                  {siteRouters.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name} {r.status === 'offline' ? t('vouchers.gen.offlineTag') : ''}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </Step>

          <Step n={2} title={t('vouchers.gen.step.plan')}>
            {activePlans.length === 0 ? (
              <p className="text-slate-600">{t('vouchers.gen.noPlans')}</p>
            ) : (
              <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
                {activePlans.map((p) => {
                  const picked = p.id === planId;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      aria-pressed={picked}
                      onClick={() => setPlanId(p.id)}
                      className={`flex min-h-14 items-center gap-3 rounded-xl p-3 text-start ring-2 transition ${picked ? 'bg-brand-50 ring-brand-600' : 'bg-white ring-slate-200 hover:ring-slate-300'}`}
                    >
                      <span className="h-8 w-2 shrink-0 rounded-full" style={{ backgroundColor: p.color }} />
                      <span className="min-w-0 flex-1">
                        <span className="block font-bold text-slate-900">{p.name}</span>
                        <span className="block text-sm text-slate-600">
                          {formatSSP(p.price_ssp)} · {durationText(p.uptime_seconds)}
                        </span>
                      </span>
                      {picked && <span className="text-xl font-bold text-brand-700">✓</span>}
                    </button>
                  );
                })}
              </div>
            )}
          </Step>

          <Step n={3} title={t('vouchers.gen.step.howMany')}>
            <div className="flex flex-wrap gap-2">
              {['50', '100', '200', '500'].map((n) => (
                <button
                  key={n}
                  type="button"
                  aria-pressed={quantity === n}
                  onClick={() => setQuantity(n)}
                  className={`min-h-11 min-w-16 rounded-xl px-4 font-bold ring-2 ${quantity === n ? 'bg-brand-600 text-white ring-brand-600' : 'bg-white text-slate-800 ring-slate-200'}`}
                >
                  {n}
                </button>
              ))}
              <div className="w-28">
                <TextInput
                  aria-label={t('vouchers.gen.quantity')}
                  inputMode="numeric"
                  dir="ltr"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value.replace(/\D/g, '').slice(0, 4))}
                />
              </div>
            </div>
            <p className="text-sm text-slate-500">{t('vouchers.gen.quantityHint')}</p>
          </Step>

          {/* The code length is set from the router's own cards; most people never change it. */}
          <details open={Boolean(ownLength && Number(codeLength) !== ownLength) || undefined}>
            <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold text-slate-700">
              {t('vouchers.gen.lengthSummary', { n: codeLength })}
            </summary>
            <div className="mt-2 max-w-48">
              <Field label={t('vouchers.gen.codeLength')} hint={ownLength ? t('vouchers.gen.digitsRouter', { n: ownLength }) : t('vouchers.gen.digits')}>
                <Select value={codeLength} onChange={(e) => setCodeLength(e.target.value)}>
                  {[6, 7, 8, 9, 10].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          </details>

          {ownLength && Number(codeLength) !== ownLength && (
            <Alert tone="warning">
              {t('vouchers.gen.lengthWarn', { router: router?.name ?? '', own: ownLength, len: codeLength })}
            </Alert>
          )}

          {router?.status === 'offline' && (
            <Alert tone="warning">
              {router.last_seen_at
                ? t('vouchers.gen.offlineWarnSince', { name: router.name, time: formatJubaTime(router.last_seen_at) })
                : t('vouchers.gen.offlineWarn', { name: router.name })}
            </Alert>
          )}
          {generate.error && <Alert tone="error">{generate.error.message}</Alert>}
          {notice && <Alert tone="success">{notice}</Alert>}

          <Button type="submit" disabled={generate.isPending || !routerId || !planId} className="min-h-12 w-full px-8 text-lg sm:w-auto">
            {generate.isPending && <Spinner />} {t('vouchers.gen.generate')}
          </Button>
        </form>
      </Card>

      <Card>
        <h2 className="text-lg font-bold">{t('vouchers.gen.recent')}</h2>
        {batches.isLoading && <Spinner className="mt-3 h-6 w-6 text-brand-600" />}
        {batches.error && <Alert tone="error">{friendlyError(batches.error)}</Alert>}
        {batches.data?.length === 0 && <p className="mt-2 text-slate-600">{t('vouchers.gen.noBatches')}</p>}
        <ul className="mt-1">
          {(batches.data ?? []).map((b) => (
            <BatchRow key={b.id} batch={b} />
          ))}
        </ul>
      </Card>
    </div>
  );
}
