import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '../../components/PageHeader';
import { Alert, Button, Card, Checkbox, Field, Select, TextInput } from '../../components/ui';
import { friendlyError } from '../../lib/errors';
import { formatDuration, formatJubaTime, formatNumber, formatSSP } from '../../lib/format';
import { usePlans, useRouters } from '../../hooks/queries';
import { supabase } from '../../lib/supabase';
import { LAYOUTS, type CardsPerPage } from '../../print/layouts';

interface BatchOption {
  id: string;
  created_at: string;
  quantity: number;
  code_length: number;
  plan_name: string;
  router_name: string;
  pushed_count: number;
}

type Source = 'batch' | 'unused';

export function PrintSetupPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const routers = useRouters();
  const plans = usePlans();
  const [source, setSource] = useState<Source>('batch');
  const [batchId, setBatchId] = useState(params.get('batch') ?? '');
  const [routerId, setRouterId] = useState('');
  const [planId, setPlanId] = useState('');
  const [onlyNew, setOnlyNew] = useState(true);
  const [count, setCount] = useState('');
  const [perPage, setPerPage] = useState<CardsPerPage>(40);

  const batches = useQuery({
    queryKey: ['print-batches'],
    queryFn: async (): Promise<BatchOption[]> => {
      const { data, error } = await supabase
        .from('voucher_batch_status')
        .select('id, created_at, quantity, code_length, plan_name, router_name, pushed_count')
        .gt('pushed_count', 0)
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw new Error(error.message);
      return (data ?? []) as BatchOption[];
    },
  });

  const usableRouters = (routers.data ?? []).filter((r) => r.status !== 'pending');
  useEffect(() => {
    if (!routerId && usableRouters.length === 1) setRouterId(usableRouters[0]?.id ?? '');
  }, [routerId, usableRouters]);

  // Longest code in the selection decides whether 50 per page fits.
  const codeLength = useQuery({
    queryKey: ['print-code-length', source, batchId, routerId, planId],
    enabled: source === 'batch' ? Boolean(batchId) : Boolean(routerId),
    queryFn: async (): Promise<number> => {
      if (source === 'batch') return batches.data?.find((b) => b.id === batchId)?.code_length ?? 8;
      let q = supabase.from('voucher_batches').select('code_length').eq('router_id', routerId).order('code_length', { ascending: false }).limit(1);
      if (planId) q = q.eq('plan_id', planId);
      const { data } = await q;
      return data?.[0]?.code_length ?? 8;
    },
  });

  const fiftyFits = (codeLength.data ?? 8) <= LAYOUTS[50].maxCodeLength;
  useEffect(() => {
    if (!fiftyFits && perPage === 50) setPerPage(40);
  }, [fiftyFits, perPage]);

  const target = useMemo(() => {
    const q = new URLSearchParams({ per: String(perPage) });
    if (source === 'batch') {
      if (!batchId) return null;
      q.set('batch', batchId);
    } else {
      if (!routerId) return null;
      q.set('router', routerId);
      if (planId) q.set('plan', planId);
      q.set('new', onlyNew ? '1' : '0');
      if (count) q.set('count', count);
    }
    return `/print/sheet?${q.toString()}`;
  }, [source, batchId, routerId, planId, onlyNew, count, perPage]);

  return (
    <div className="max-w-3xl space-y-4">
      <PageHeader title="Print voucher cards" subtitle="A4 sheets with cut lines. Printing is not a sale; cards stay unused until sold." />

      <Card>
        <div className="mb-4 grid grid-cols-2 gap-2">
          {(['batch', 'unused'] as Source[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSource(s)}
              className={`min-h-12 rounded-xl px-3 font-semibold ring-1 ${source === s ? 'bg-brand-600 text-white ring-brand-600' : 'bg-white text-slate-700 ring-slate-300'}`}
            >
              {s === 'batch' ? 'A batch' : 'Unused cards'}
            </button>
          ))}
        </div>

        {source === 'batch' ? (
          <Field label="Batch">
            <Select value={batchId} onChange={(e) => setBatchId(e.target.value)}>
              <option value="">Choose a batch…</option>
              {(batches.data ?? []).map((b) => (
                <option key={b.id} value={b.id}>
                  {formatJubaTime(b.created_at)} · {formatNumber(b.pushed_count)} × {b.plan_name} · {b.router_name}
                </option>
              ))}
            </Select>
          </Field>
        ) : (
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
            <Field label="Plan">
              <Select value={planId} onChange={(e) => setPlanId(e.target.value)}>
                <option value="">All plans</option>
                {(plans.data ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} — {formatSSP(p.price_ssp)} · {formatDuration(p.uptime_seconds)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="How many cards" hint="Empty = all matching cards (max 1000)">
              <TextInput inputMode="numeric" value={count} placeholder="all" onChange={(e) => setCount(e.target.value.replace(/\D/g, '').slice(0, 4))} />
            </Field>
            <div className="flex items-end">
              <Checkbox label="Only cards not printed before" checked={onlyNew} onChange={setOnlyNew} />
            </div>
          </div>
        )}

        <div className="mt-5">
          <span className="mb-2 block text-sm font-medium text-slate-700">Cards per A4 page</span>
          <div className="grid grid-cols-3 gap-2">
            {([24, 40, 50] as CardsPerPage[]).map((n) => {
              const disabled = n === 50 && !fiftyFits;
              return (
                <button
                  key={n}
                  type="button"
                  disabled={disabled}
                  onClick={() => setPerPage(n)}
                  className={`min-h-14 rounded-xl text-xl font-bold ring-1 disabled:cursor-not-allowed disabled:opacity-40 ${
                    perPage === n ? 'bg-brand-600 text-white ring-brand-600' : 'bg-white text-slate-800 ring-slate-300'
                  }`}
                >
                  {n}
                  <span className="block text-xs font-medium">
                    {LAYOUTS[n].cols} × {LAYOUTS[n].rows}
                  </span>
                </button>
              );
            })}
          </div>
          {!fiftyFits && <p className="mt-2 text-sm text-slate-600">50 per page fits codes up to 8 digits. These codes are longer.</p>}
        </div>

        {batches.error && (
          <div className="mt-4">
            <Alert tone="error">{friendlyError(batches.error)}</Alert>
          </div>
        )}

        <Button className="mt-5 min-h-12 px-6 text-lg" disabled={!target} onClick={() => target && navigate(target)}>
          Open print preview
        </Button>
      </Card>
    </div>
  );
}
