import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { friendlyError } from '../lib/errors';
import { invokeFunction } from '../lib/functions';
import { supabase } from '../lib/supabase';
import { useT } from '../i18n';
import { Alert, Button, Field, Spinner, TextInput } from './ui';

export interface RemovedBusiness {
  removed: string;
  users_removed: number;
}

/**
 * Platform owner: removes a business for good once its name is typed. A business still switched on
 * is switched off first (the database only removes switched-off businesses).
 */
export function RemoveBusiness({
  id,
  name,
  active,
  onClose,
  onRemoved,
}: {
  id: string;
  name: string;
  active: boolean;
  onClose: () => void;
  onRemoved?: (r: RemovedBusiness) => void;
}) {
  const { t } = useT();
  const queryClient = useQueryClient();
  const [typed, setTyped] = useState('');
  const remove = useMutation({
    mutationFn: async () => {
      if (active) {
        const { error } = await supabase.rpc('platform_set_tenant_active', { p_tenant_id: id, p_active: false });
        if (error) throw error;
      }
      return invokeFunction<RemovedBusiness>('delete-items', { action: 'delete_business', id, name: typed });
    },
    onSuccess: (r) => onRemoved?.(r),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['businesses'] });
      void queryClient.invalidateQueries({ queryKey: ['platform-billing'] });
    },
  });
  const matches = typed.trim().toLowerCase() === name.trim().toLowerCase();

  return (
    <form
      className="space-y-3 rounded-lg bg-red-50 p-3 ring-1 ring-red-200"
      onSubmit={(e) => {
        e.preventDefault();
        if (matches) remove.mutate();
      }}
    >
      <div className="font-bold text-red-800">{t('business.businesses.removeTitle', { name })}</div>
      <p className="text-sm text-red-800">{t('business.businesses.removeText')}</p>
      <Field label={t('business.businesses.removeType', { name })}>
        <TextInput value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} />
      </Field>
      {remove.error && <Alert tone="error">{friendlyError(remove.error)}</Alert>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="danger" disabled={remove.isPending || !matches}>
          {remove.isPending && <Spinner />} {t('business.businesses.removeConfirm')}
        </Button>
        <Button type="button" variant="secondary" onClick={onClose}>
          {t('common.cancel')}
        </Button>
      </div>
    </form>
  );
}
