import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Badge, Button, Card, Spinner } from './ui';
import { friendlyError } from '../lib/errors';
import { useT } from '../i18n';
import { invokeFunction } from '../lib/functions';
import type { WhatsAppStatus } from '../lib/whatsapp';

/**
 * Platform admins: Hotzonex Cloud's WhatsApp sender (a second SIM linked to the tunnel server, like
 * WhatsApp Web). Install it with one command, scan the QR code with the sender phone, done.
 */
export function WhatsAppSender() {
  const { t, dir } = useT();
  const arrow = dir === 'rtl' ? '←' : '→';
  const queryClient = useQueryClient();
  const [command, setCommand] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const status = useQuery({
    queryKey: ['whatsapp-status'],
    queryFn: () => invokeFunction<WhatsAppStatus>('alerts', { action: 'whatsapp_status' }),
    // Every 3 s while linking (the QR code changes), otherwise every 30 s.
    refetchInterval: (q) => (q.state.data?.connected ? 30_000 : 3_000),
  });
  const setup = useMutation({
    mutationFn: () => invokeFunction<{ command: string }>('alerts', { action: 'whatsapp_setup' }),
    onSuccess: (d) => {
      setCommand(d.command);
      void queryClient.invalidateQueries({ queryKey: ['whatsapp-status'] });
    },
  });
  const logout = useMutation({
    mutationFn: () => invokeFunction('alerts', { action: 'whatsapp_logout' }),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ['whatsapp-status'] }),
  });

  async function copy() {
    if (!command) return;
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
    } catch {
      window.alert(t('business.wa.copyBlocked'));
    }
  }

  const s = status.data;
  const error = setup.error ?? logout.error;
  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold">{t('business.wa.title')}</h2>
        {s && (s.connected ? (
            <Badge color="green">{t('business.wa.connected')}</Badge>
          ) : s.installed ? (
            <Badge color="red">{t('business.wa.notConnected')}</Badge>
          ) : (
            <Badge color="gray">{t('business.wa.notSetUp')}</Badge>
          ))}
      </div>
      <p className="text-sm text-slate-600">{t('business.wa.intro')}</p>

      {status.isLoading && <Spinner />}
      {status.error && <Alert tone="error">{friendlyError(status.error)}</Alert>}

      {s?.connected && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-slate-700">
            {t('business.wa.sendingFrom')} <b dir={s.sender ? 'ltr' : undefined}>{s.sender ?? t('business.wa.linkedPhone')}</b>
            {t('business.wa.keepCharged')}
          </p>
          <Button
            variant="danger"
            onClick={() => window.confirm(t('business.wa.confirmUnlink')) && logout.mutate()}
            disabled={logout.isPending}
          >
            {logout.isPending && <Spinner />} {t('business.wa.unlink')}
          </Button>
        </div>
      )}

      {s?.installed && !s.connected && s.qr && (
        <div className="flex flex-col items-start gap-3 sm:flex-row">
          <img src={s.qr} alt={t('business.wa.qrAlt')} className="h-56 w-56 rounded-xl bg-white p-2 ring-1 ring-slate-200" />
          <ol className="list-decimal space-y-1 ps-5 text-sm text-slate-700">
            <li>{t('business.wa.step1')}</li>
            <li>
              {t('business.wa.openWhatsapp')} {arrow} <b>{t('business.wa.settings')}</b> {t('business.wa.orMenu')} {arrow} <b>{t('business.wa.linkedDevices')}</b>{' '}
              {arrow} <b>{t('business.wa.linkDevice')}</b>.
            </li>
            <li>{t('business.wa.step3')}</li>
          </ol>
        </div>
      )}
      {s?.installed && !s.connected && !s.qr && (
        <Alert tone="warning">
          {s.reachable === false
            ? t('business.wa.unreachable', { error: s.error ? ` (${s.error})` : '' })
            : t('business.wa.starting')}
        </Alert>
      )}

      {(!s?.installed || s.reachable === false || command) && (
        <div className="space-y-2">
          {!command ? (
            <Button onClick={() => setup.mutate()} disabled={setup.isPending}>
              {setup.isPending && <Spinner />} {s?.installed ? t('business.wa.showCommand') : t('business.wa.setUp')}
            </Button>
          ) : (
            <>
              <p className="text-sm text-slate-700">{t('business.wa.pasteCommand')}</p>
              <Button onClick={copy}>{copied ? t('common.copied') : t('business.wa.copyCommand')}</Button>
              <pre dir="ltr" className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-slate-900 p-3 text-xs text-slate-100">{command}</pre>
              <p className="text-xs text-slate-500">{t('business.wa.secret')}</p>
            </>
          )}
        </div>
      )}
      {error && <Alert tone="error">{friendlyError(error)}</Alert>}
    </Card>
  );
}
