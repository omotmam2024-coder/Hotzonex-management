import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Field, Spinner, TextInput } from './ui';
import { friendlyError } from '../lib/errors';
import { formatNumber, formatSSP } from '../lib/format';
import { useT } from '../i18n';
import { fromJson, supabase } from '../lib/supabase';

interface Preview {
  name: string;
  vouchers: number;
  batches: number;
  sales: number;
  revenue: number;
  router_logins?: number;
  plans_only_here?: number;
  unsold_on_routers?: number;
}

/**
 * Owners: remove a router or a plan completely, with its vouchers and sales, after seeing what
 * goes and typing its name. Used when the normal Remove/Delete refuses because of sales.
 */
export function ForceRemove({ kind, id, name, onClose, onDone }: { kind: 'router' | 'plan'; id: string; name: string; onClose: () => void; onDone: (text: string) => void }) {
  const { t } = useT();
  const queryClient = useQueryClient();
  const [typed, setTyped] = useState('');
  const preview = useQuery({
    queryKey: ['removal-preview', kind, id],
    staleTime: 0,
    gcTime: 0,
    queryFn: async (): Promise<Preview> => {
      const { data, error } = await supabase.rpc('removal_preview', { p_kind: kind, p_id: id });
      if (error) throw error;
      return fromJson<Preview>(data);
    },
  });
  const remove = useMutation({
    mutationFn: async () => {
      const { error } =
        kind === 'router'
          ? await supabase.rpc('force_remove_router', { p_router_id: id, p_name: typed })
          : await supabase.rpc('force_remove_plan', { p_plan_id: id, p_name: typed });
      if (error) throw error;
    },
    onSuccess: () => {
      for (const key of [['routers'], ['plans'], ['vouchers'], ['sales'], ['stock'], ['dashboard'], ['report'], ['batch-options']]) void queryClient.invalidateQueries({ queryKey: key });
      onDone(t('force.done', { name }));
    },
  });
  const p = preview.data;
  const matches = typed.trim().toLowerCase() === name.trim().toLowerCase();

  return (
    <form
      className="mt-3 space-y-3 rounded-lg bg-red-50 p-3 ring-1 ring-red-200"
      onSubmit={(e) => {
        e.preventDefault();
        if (matches) remove.mutate();
      }}
    >
      <div className="font-bold text-red-800">{t(kind === 'router' ? 'force.titleRouter' : 'force.titlePlan', { name })}</div>
      {preview.isLoading && <Spinner />}
      {preview.error && <Alert tone="error">{friendlyError(preview.error)}</Alert>}
      {p && (
        <ul className="list-disc space-y-0.5 ps-5 text-sm text-red-800">
          <li>{t('force.sales', { n: formatNumber(p.sales), amount: formatSSP(p.revenue) })}</li>
          <li>{t('force.vouchers', { n: formatNumber(p.vouchers), b: formatNumber(p.batches) })}</li>
          {kind === 'router' && <li>{t('force.logins', { n: formatNumber(p.router_logins ?? 0) })}</li>}
          {kind === 'router' && (p.plans_only_here ?? 0) > 0 && <li>{t('force.plansOnlyHere', { n: formatNumber(p.plans_only_here ?? 0) })}</li>}
          {kind === 'plan' && (p.unsold_on_routers ?? 0) > 0 && <li>{t('force.unsoldOnRouters', { n: formatNumber(p.unsold_on_routers ?? 0) })}</li>}
        </ul>
      )}
      <p className="text-sm text-red-800">{t(kind === 'router' ? 'force.warnRouter' : 'force.warnPlan')}</p>
      <Field label={t('force.type', { name })}>
        <TextInput value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} />
      </Field>
      {remove.error && <Alert tone="error">{friendlyError(remove.error)}</Alert>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="danger" disabled={!matches || remove.isPending || !p}>
          {remove.isPending && <Spinner />} {t('force.button')}
        </Button>
        <Button type="button" variant="secondary" onClick={onClose}>
          {t('common.cancel')}
        </Button>
      </div>
    </form>
  );
}
