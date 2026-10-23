import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Badge, Button, Card, Checkbox, Field, Select, Spinner, TextInput } from './ui';
import { friendlyError } from '../lib/errors';
import { invokeFunction } from '../lib/functions';
import { fromJson, supabase } from '../lib/supabase';
import { useT } from '../i18n';

interface MomoAccountInfo {
  configured: boolean;
  enabled?: boolean;
  environment?: 'sandbox' | 'production';
  target_environment?: string;
  currency?: string;
  api_user?: string;
}

/**
 * The business's own MTN MoMo API login (owner only). With it on, customers on the Buy page pay with
 * a prompt on their phone and get their card as soon as MoMo confirms. The keys are sent to the
 * momo function, stored encrypted and never shown again.
 */
export function MomoSettings() {
  const { t } = useT();
  const queryClient = useQueryClient();
  const info = useQuery({
    queryKey: ['momo-account'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('momo_account');
      // Before the MoMo API migration is applied (PGRST202: no such function): the card stays hidden.
      if (error?.code === 'PGRST202') return null;
      if (error) throw new Error(friendlyError(error));
      return fromJson<MomoAccountInfo>(data);
    },
  });

  const [enabled, setEnabled] = useState(false);
  const [environment, setEnvironment] = useState<'sandbox' | 'production'>('sandbox');
  const [target, setTarget] = useState('sandbox');
  const [currency, setCurrency] = useState('EUR');
  const [apiUser, setApiUser] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [subKey, setSubKey] = useState('');

  useEffect(() => {
    const d = info.data;
    if (!d?.configured) return;
    setEnabled(Boolean(d.enabled));
    setEnvironment(d.environment ?? 'sandbox');
    setTarget(d.target_environment ?? 'sandbox');
    setCurrency(d.currency ?? 'SSP');
    setApiUser(d.api_user ?? '');
  }, [info.data]);

  function chooseEnvironment(v: 'sandbox' | 'production') {
    setEnvironment(v);
    // The sandbox takes only "sandbox" and EUR; real payments in South Sudan are in SSP.
    if (v === 'sandbox') {
      setTarget('sandbox');
      setCurrency('EUR');
    } else {
      if (target === 'sandbox') setTarget('');
      if (currency === 'EUR') setCurrency('SSP');
    }
  }

  const configured = Boolean(info.data?.configured);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['momo-account'] });

  const save = useMutation({
    mutationFn: () =>
      invokeFunction('momo', {
        action: 'save',
        enabled,
        environment,
        target_environment: target,
        currency,
        api_user: apiUser,
        api_key: apiKey,
        subscription_key: subKey,
      }),
    onSuccess: () => {
      setApiKey('');
      setSubKey('');
      test.reset();
      refresh();
    },
  });
  const test = useMutation({ mutationFn: () => invokeFunction('momo', { action: 'test' }) });
  const remove = useMutation({
    mutationFn: () => invokeFunction('momo', { action: 'remove' }),
    onSuccess: () => {
      setEnabled(false);
      setApiUser('');
      refresh();
    },
  });

  if (info.isLoading) return <Spinner />;
  if (info.data === null) return null;
  const keyHint = configured ? t('sales.momo.keepKey') : undefined;

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-bold">{t('sales.momo.title')}</h2>
        {configured && info.data?.enabled ? <Badge color="green">{t('sales.buy.open')}</Badge> : <Badge color="gray">{t('sales.buy.closed')}</Badge>}
        {configured && info.data?.environment === 'sandbox' && <Badge color="gray">{t('sales.momo.sandboxBadge')}</Badge>}
      </div>
      <p className="text-sm text-slate-600">{t('sales.momo.text')}</p>
      {info.error && <Alert tone="error">{friendlyError(info.error)}</Alert>}

      <Checkbox label={t('sales.momo.on')} checked={enabled} onChange={setEnabled} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('sales.momo.environment')}>
          <Select value={environment} onChange={(e) => chooseEnvironment(e.target.value === 'production' ? 'production' : 'sandbox')}>
            <option value="sandbox">{t('sales.momo.sandbox')}</option>
            <option value="production">{t('sales.momo.production')}</option>
          </Select>
        </Field>
        <Field label={t('sales.momo.target')} hint={t('sales.momo.targetHint')}>
          <TextInput dir="ltr" value={target} onChange={(e) => setTarget(e.target.value.toLowerCase().replace(/[^a-z]/g, '').slice(0, 40))} />
        </Field>
        <Field label={t('sales.momo.currency')} hint={t('sales.momo.currencyHint')}>
          <TextInput dir="ltr" value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3))} />
        </Field>
        <Field label={t('sales.momo.apiUser')}>
          <TextInput dir="ltr" autoComplete="off" spellCheck={false} value={apiUser} onChange={(e) => setApiUser(e.target.value.trim())} placeholder="1a2b3c4d-…" />
        </Field>
        <Field label={t('sales.momo.apiKey')} hint={keyHint}>
          <TextInput dir="ltr" type="password" autoComplete="new-password" value={apiKey} onChange={(e) => setApiKey(e.target.value.trim())} />
        </Field>
        <Field label={t('sales.momo.subKey')} hint={keyHint}>
          <TextInput dir="ltr" type="password" autoComplete="new-password" value={subKey} onChange={(e) => setSubKey(e.target.value.trim())} />
        </Field>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => save.mutate()} disabled={save.isPending} className="min-h-12">
          {save.isPending && <Spinner />} {t('common.save')}
        </Button>
        {configured && (
          <Button variant="secondary" onClick={() => test.mutate()} disabled={test.isPending} className="min-h-12">
            {test.isPending && <Spinner />} {t('sales.momo.test')}
          </Button>
        )}
        {configured && (
          <Button
            variant="secondary"
            onClick={() => window.confirm(t('sales.momo.removeConfirm')) && remove.mutate()}
            disabled={remove.isPending}
            className="min-h-12"
          >
            {t('sales.momo.remove')}
          </Button>
        )}
      </div>
      {save.isSuccess && <Alert tone="success">{t('sales.momo.saved')}</Alert>}
      {test.isSuccess && <Alert tone="success">{t('sales.momo.testOk')}</Alert>}
      {(save.error ?? test.error ?? remove.error) && <Alert tone="error">{friendlyError(save.error ?? test.error ?? remove.error)}</Alert>}
      {environment === 'sandbox' && enabled && <Alert tone="warning">{t('sales.momo.sandboxWarning')}</Alert>}
    </Card>
  );
}
