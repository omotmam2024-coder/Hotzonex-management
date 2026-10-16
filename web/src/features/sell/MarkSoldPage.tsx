import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../auth/AuthProvider';
import { PageHeader } from '../../components/PageHeader';
import { Alert, Badge, Button, Card, Field, Select, Spinner } from '../../components/ui';
import { friendlyError } from '../../lib/errors';
import { formatJubaTime, formatNumber, formatSSP } from '../../lib/format';
import { invalidateSalesData, usePlans, useRouters } from '../../hooks/queries';
import { fromJson, supabase } from '../../lib/supabase';
import type { VoucherStatus } from '../../lib/types';

type Mode = 'batch' | 'codes';

interface Candidate {
  id: string;
  code: string;
  plan_id: string;
  status: VoucherStatus;
  printed_at: string | null;
}

interface MarkResult {
  sold: number;
  total_ssp: number;
  skipped: { code: string; reason: string }[];
}

interface StaffOption {
  id: string;
  full_name: string;
  role: string;
  site_id: string | null;
  is_active: boolean;
}

/** Pulls 6–10 digit codes out of whatever was typed or pasted. */
function parseCodes(text: string): string[] {
  return [...new Set(text.match(/\d{6,10}/g) ?? [])];
}

export function MarkSoldPage() {
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const routers = useRouters();
  const plans = usePlans();
  const [routerId, setRouterId] = useState('');
  const [mode, setMode] = useState<Mode>('batch');
  const [batchId, setBatchId] = useState('');
  const [codesText, setCodesText] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sellerId, setSellerId] = useState('');
  const [result, setResult] = useState<MarkResult | null>(null);

  const usableRouters = (routers.data ?? []).filter((r) => r.status !== 'pending');
  useEffect(() => {
    if (!routerId && usableRouters.length === 1) setRouterId(usableRouters[0]?.id ?? '');
  }, [routerId, usableRouters]);
  const router = usableRouters.find((r) => r.id === routerId);
  const planById = new Map((plans.data ?? []).map((p) => [p.id, p]));

  const batches = useQuery({
    queryKey: ['mark-batches', routerId],
    enabled: Boolean(routerId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('voucher_batch_status')
        .select('id, created_at, quantity, plan_name')
        .eq('router_id', routerId)
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw new Error(error.message);
      return (data ?? []) as { id: string; created_at: string; quantity: number; plan_name: string }[];
    },
  });

  const typedCodes = useMemo(() => parseCodes(codesText), [codesText]);

  const candidates = useQuery({
    queryKey: ['mark-candidates', mode, routerId, batchId, typedCodes.join(',')],
    enabled: Boolean(routerId) && (mode === 'batch' ? Boolean(batchId) : typedCodes.length > 0),
    queryFn: async (): Promise<Candidate[]> => {
      let q = supabase.from('vouchers').select('id, code, plan_id, status, printed_at').eq('router_id', routerId).eq('on_router', true);
      q = mode === 'batch' ? q.eq('batch_id', batchId).eq('status', 'unused').not('printed_at', 'is', null) : q.in('code', typedCodes.slice(0, 1000));
      const { data, error } = await q.order('code').limit(1000);
      if (error) throw new Error(error.message);
      return (data ?? []) as Candidate[];
    },
  });

  // Select every eligible card whenever the list changes.
  useEffect(() => {
    const list = candidates.data ?? [];
    setSelected(new Set(list.filter((c) => c.status !== 'disabled' && c.printed_at).map((c) => c.id)));
  }, [candidates.data]);

  const staff = useQuery({
    queryKey: ['staff-options-full'],
    queryFn: async (): Promise<StaffOption[]> => {
      const { data, error } = await supabase.from('profiles').select('id, full_name, role, site_id, is_active').eq('is_active', true).order('full_name');
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
  const sellers = (staff.data ?? []).filter((s) => s.site_id === router?.site_id || s.id === profile?.id);
  useEffect(() => {
    if (sellerId && !sellers.some((s) => s.id === sellerId)) setSellerId('');
  }, [sellers, sellerId]);

  const list = candidates.data ?? [];
  const notFound = mode === 'codes' && candidates.data ? typedCodes.filter((c) => !list.some((v) => v.code === c)) : [];
  const chosen = list.filter((c) => selected.has(c.id));
  const total = chosen.reduce((sum, c) => sum + (planById.get(c.plan_id)?.price_ssp ?? 0), 0);

  const mark = useMutation({
    mutationFn: async (): Promise<MarkResult> => {
      if (!sellerId) throw new Error('Choose the seller who handed out these cards.');
      if (chosen.length === 0) throw new Error('Select at least one card.');
      const { data, error } = await supabase.rpc('mark_vouchers_sold', { p_voucher_ids: chosen.map((c) => c.id), p_seller_id: sellerId });
      if (error) throw new Error(friendlyError(error));
      return fromJson<MarkResult>(data);
    },
    onSuccess: (r) => {
      setResult(r);
      setCodesText('');
      invalidateSalesData(queryClient);
    },
  });

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="max-w-4xl space-y-4">
      <PageHeader title="Mark printed cards as sold" subtitle="Records one cash sale per card at the plan price, for cards handed out from A4 sheets." />

      <Card>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Router">
            <Select value={routerId} onChange={(e) => setRouterId(e.target.value)}>
              <option value="">Choose a router…</option>
              {usableRouters.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Cashier or agent who handed out the cards">
            <Select value={sellerId} onChange={(e) => setSellerId(e.target.value)} disabled={!router}>
              <option value="">Choose a seller…</option>
              {sellers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.full_name} ({s.role})
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          {(['batch', 'codes'] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setMode(m);
                setResult(null);
              }}
              className={`min-h-12 rounded-xl px-3 font-semibold ring-1 ${mode === m ? 'bg-brand-600 text-white ring-brand-600' : 'bg-white text-slate-700 ring-slate-300'}`}
            >
              {m === 'batch' ? 'From a printed batch' : 'Type codes'}
            </button>
          ))}
        </div>

        <div className="mt-4">
          {mode === 'batch' ? (
            <Field label="Batch">
              <Select value={batchId} onChange={(e) => setBatchId(e.target.value)} disabled={!router}>
                <option value="">Choose a batch…</option>
                {(batches.data ?? []).map((b) => (
                  <option key={b.id} value={b.id}>
                    {formatJubaTime(b.created_at)} · {b.quantity} × {b.plan_name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : (
            <Field label="Codes" hint="One per line, or separated by spaces or commas">
              <textarea
                value={codesText}
                onChange={(e) => setCodesText(e.target.value)}
                rows={4}
                inputMode="numeric"
                disabled={!router}
                className="w-full rounded-xl border border-slate-300 p-3 font-mono text-lg focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
                placeholder={'48213570\n48221489'}
              />
            </Field>
          )}
        </div>
      </Card>

      {result && (
        <Alert tone={result.sold > 0 ? 'success' : 'warning'}>
          <strong>
            {formatNumber(result.sold)} sale{result.sold === 1 ? '' : 's'} recorded · {formatSSP(result.total_ssp)}
          </strong>
          {result.skipped.length > 0 && (
            <ul className="mt-2 list-disc pl-5">
              {result.skipped.map((s) => (
                <li key={s.code}>
                  <span className="font-mono">{s.code}</span>: {s.reason}
                </li>
              ))}
            </ul>
          )}
          <div className="mt-2">
            <Link to="/sales" className="font-semibold underline">
              View sales
            </Link>
          </div>
        </Alert>
      )}

      {candidates.error && <Alert tone="error">{friendlyError(candidates.error)}</Alert>}
      {notFound.length > 0 && (
        <Alert tone="warning">
          Not found on {router?.name}: <span className="font-mono">{notFound.join(', ')}</span>
        </Alert>
      )}

      {candidates.isFetching && <Spinner className="h-6 w-6 text-brand-600" />}

      {list.length > 0 && (
        <Card className="!p-0">
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
            <span className="font-semibold">
              {formatNumber(chosen.length)} of {formatNumber(list.length)} selected · {formatSSP(total)}
            </span>
            <div className="flex gap-3 text-sm font-semibold text-brand-700">
              <button type="button" onClick={() => setSelected(new Set(list.filter((c) => c.status !== 'disabled' && c.printed_at).map((c) => c.id)))}>
                Select all
              </button>
              <button type="button" onClick={() => setSelected(new Set())}>
                Select none
              </button>
            </div>
          </div>
          <ul className="max-h-96 divide-y divide-slate-100 overflow-y-auto border-t border-slate-100">
            {list.map((c) => {
              const plan = planById.get(c.plan_id);
              const blocked = c.status === 'disabled' ? 'Disabled' : !c.printed_at ? 'Not printed — sell on the Sell screen' : null;
              return (
                <li key={c.id}>
                  <label className={`flex min-h-12 items-center gap-3 px-4 py-2 ${blocked ? 'opacity-60' : 'cursor-pointer'}`}>
                    <input type="checkbox" className="h-5 w-5" checked={selected.has(c.id)} disabled={Boolean(blocked)} onChange={() => toggle(c.id)} />
                    <span className="font-mono text-lg font-semibold tracking-wider">{c.code}</span>
                    <span className="h-3 w-3 rounded-full" style={{ backgroundColor: plan?.color ?? '#94a3b8' }} />
                    <span className="text-sm text-slate-600">
                      {plan?.name} · {plan ? formatSSP(plan.price_ssp) : ''}
                    </span>
                    <span className="ml-auto">{blocked ? <span className="text-xs text-slate-500">{blocked}</span> : c.status !== 'unused' && <Badge color="blue">{c.status}</Badge>}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
      {mode === 'batch' && batchId && candidates.data && list.length === 0 && <Alert tone="info">No printed, unsold cards left in this batch.</Alert>}

      {mark.error && <Alert tone="error">{mark.error.message}</Alert>}
      <Button className="min-h-12 px-6 text-lg" disabled={mark.isPending || chosen.length === 0 || !sellerId} onClick={() => mark.mutate()}>
        {mark.isPending && <Spinner />} Record {formatNumber(chosen.length)} cash sale{chosen.length === 1 ? '' : 's'} · {formatSSP(total)}
      </Button>
    </div>
  );
}
