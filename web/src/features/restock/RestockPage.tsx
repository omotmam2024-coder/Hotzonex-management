import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '../../components/PageHeader';
import { Alert, Badge, Button, Card, Field, Select, Spinner, TextInput, textButtonClass } from '../../components/ui';
import { usePlans, useRouters } from '../../hooks/queries';
import { useT } from '../../i18n';
import { friendlyError } from '../../lib/errors';
import { formatJubaTime, formatNumber } from '../../lib/format';
import { supabase } from '../../lib/supabase';
import { restockRuleSchema, validate } from '../../lib/validation';

interface Rule {
  id: string;
  router_id: string;
  plan_id: string;
  keep_min: number;
  add_quantity: number;
  is_active: boolean;
  last_run_at: string | null;
}

const KEY = ['restock-rules'];

function useRules() {
  return useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<Rule[]> => {
      const { data, error } = await supabase
        .from('restock_rules')
        .select('id, router_id, plan_id, keep_min, add_quantity, is_active, last_run_at')
        .order('created_at');
      if (error) throw new Error(friendlyError(error));
      return data ?? [];
    },
  });
}

function save(rule: { id: string | null; routerId: string; planId: string; keepMin: number; addQuantity: number; active: boolean }) {
  return supabase.rpc('save_restock_rule', {
    p_id: rule.id,
    p_router_id: rule.routerId,
    p_plan_id: rule.planId,
    p_keep_min: rule.keepMin,
    p_add_quantity: rule.addQuantity,
    p_is_active: rule.active,
  });
}

function RuleForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const { t } = useT();
  const routers = useRouters();
  const plans = usePlans();
  const [routerId, setRouterId] = useState('');
  const [planId, setPlanId] = useState('');
  const [keepMin, setKeepMin] = useState('');
  const [addQuantity, setAddQuantity] = useState('');
  const create = useMutation({
    mutationFn: async () => {
      const v = validate(restockRuleSchema, { router_id: routerId, plan_id: planId, keep_min: keepMin, add_quantity: addQuantity });
      const { error } = await save({ id: null, routerId: v.router_id, planId: v.plan_id, keepMin: v.keep_min, addQuantity: v.add_quantity, active: true });
      if (error) throw new Error(friendlyError(error));
    },
    onSuccess: onDone,
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    create.mutate();
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('restock.router')}>
          <Select value={routerId} onChange={(e) => setRouterId(e.target.value)}>
            <option value="">{t('restock.choose')}</option>
            {(routers.data ?? [])
              .filter((r) => r.status !== 'pending')
              .map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
          </Select>
        </Field>
        <Field label={t('restock.plan')}>
          <Select value={planId} onChange={(e) => setPlanId(e.target.value)}>
            <option value="">{t('restock.choose')}</option>
            {(plans.data ?? [])
              .filter((p) => p.is_active)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </Select>
        </Field>
        <Field label={t('restock.keepMin')} hint={t('restock.keepMinHint')}>
          <TextInput value={keepMin} onChange={(e) => setKeepMin(e.target.value.replace(/[^0-9]/g, '').slice(0, 4))} inputMode="numeric" placeholder="50" dir="ltr" />
        </Field>
        <Field label={t('restock.addQuantity')} hint={t('restock.addQuantityHint')}>
          <TextInput value={addQuantity} onChange={(e) => setAddQuantity(e.target.value.replace(/[^0-9]/g, '').slice(0, 4))} inputMode="numeric" placeholder="100" dir="ltr" />
        </Field>
      </div>
      {create.error && <Alert tone="error">{create.error.message}</Alert>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={create.isPending}>
          {create.isPending && <Spinner />} {t('restock.create')}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
      </div>
    </form>
  );
}

/** Owner: keep a minimum of cards on a router; the system makes more and puts them on the router by itself. */
export function RestockPage() {
  const { t } = useT();
  const queryClient = useQueryClient();
  const rules = useRules();
  const routers = useRouters();
  const plans = usePlans();
  const [adding, setAdding] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: KEY });
  const toggle = useMutation({
    mutationFn: async (r: Rule) => {
      const { error } = await save({ id: r.id, routerId: r.router_id, planId: r.plan_id, keepMin: r.keep_min, addQuantity: r.add_quantity, active: !r.is_active });
      if (error) throw new Error(friendlyError(error));
    },
    onSettled: refresh,
  });
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc('remove_restock_rule', { p_id: id });
      if (error) throw new Error(friendlyError(error));
    },
    onSettled: () => {
      setConfirmRemove(null);
      void refresh();
    },
  });

  const routerName = (id: string) => routers.data?.find((r) => r.id === id)?.name ?? '?';
  const planName = (id: string) => plans.data?.find((p) => p.id === id)?.name ?? '?';

  return (
    <div className="space-y-4">
      <PageHeader title={t('restock.title')} subtitle={t('restock.subtitle')} actions={!adding && <Button onClick={() => setAdding(true)}>{t('restock.add')}</Button>} />
      <Alert tone="info">{t('restock.rules')}</Alert>
      {adding && (
        <Card>
          <RuleForm
            onDone={() => {
              setAdding(false);
              void refresh();
            }}
            onCancel={() => setAdding(false)}
          />
        </Card>
      )}
      {rules.error && <Alert tone="error">{friendlyError(rules.error)}</Alert>}
      {(toggle.error || remove.error) && <Alert tone="error">{(toggle.error ?? remove.error)?.message}</Alert>}
      <Card>
        {rules.isLoading && <Spinner className="mx-auto block h-8 w-8 text-brand-600" />}
        {rules.data?.length === 0 && <p className="text-slate-600">{t('restock.none')}</p>}
        {rules.data && rules.data.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-start text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-600">
                  <th className="py-2 pe-3 text-start font-semibold">{t('restock.router')}</th>
                  <th className="py-2 pe-3 text-start font-semibold">{t('restock.plan')}</th>
                  <th className="py-2 pe-3 text-start font-semibold">{t('restock.keepMinShort')}</th>
                  <th className="py-2 pe-3 text-start font-semibold">{t('restock.addShort')}</th>
                  <th className="py-2 pe-3 text-start font-semibold">{t('restock.lastRun')}</th>
                  <th className="py-2 pe-3 text-start font-semibold">{t('promos.status')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rules.data.map((r) => (
                  <tr key={r.id} className="border-b border-slate-100">
                    <td className="py-2 pe-3 font-semibold">{routerName(r.router_id)}</td>
                    <td className="py-2 pe-3">{planName(r.plan_id)}</td>
                    <td className="py-2 pe-3 tabular-nums">{formatNumber(r.keep_min)}</td>
                    <td className="py-2 pe-3 tabular-nums">{formatNumber(r.add_quantity)}</td>
                    <td className="py-2 pe-3">{r.last_run_at ? formatJubaTime(r.last_run_at) : t('restock.never')}</td>
                    <td className="py-2 pe-3">
                      <Badge color={r.is_active ? 'green' : 'gray'}>{r.is_active ? t('promos.state.active') : t('promos.state.off')}</Badge>
                    </td>
                    <td className="whitespace-nowrap py-2 text-end">
                      <button type="button" className={`${textButtonClass} text-brand-700`} disabled={toggle.isPending} onClick={() => toggle.mutate(r)}>
                        {r.is_active ? t('promos.switchOff') : t('promos.switchOn')}
                      </button>
                      {confirmRemove === r.id ? (
                        <button type="button" className={`${textButtonClass} text-red-700`} disabled={remove.isPending} onClick={() => remove.mutate(r.id)}>
                          {t('restock.confirmRemove')}
                        </button>
                      ) : (
                        <button type="button" className={`${textButtonClass} text-slate-600`} onClick={() => setConfirmRemove(r.id)}>
                          {t('common.remove')}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
