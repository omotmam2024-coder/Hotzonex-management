import { useState } from 'react';
import { useTunnelServer } from '../hooks/useTunnelServer';
import { friendlyError } from '../lib/errors';
import { useT } from '../i18n';
import { rich } from './RouterSetup';
import { Alert, Badge, Button, Card, Spinner, textButtonClass } from './ui';

/** Explains the tunnel server and gives the one install command for the VPS. */
export function TunnelServerCard() {
  const tunnel = useTunnelServer();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const { t } = useT();
  const server = tunnel.data;

  async function copy() {
    if (!server?.command) return;
    try {
      await navigator.clipboard.writeText(server.command);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } catch {
      window.alert(t('routers.tunnel.copyBlocked'));
    }
  }

  if (tunnel.isLoading) return null;
  if (tunnel.error) return <Alert tone="error">{t('routers.tunnel.error', { error: friendlyError(tunnel.error) })}</Alert>;
  if (!server) return null;

  // Businesses use the shared tunnel server that Hotzonex Cloud runs; only its platform admins install it.
  if (!server.command) {
    return server.ready ? null : (
      <Alert tone="info">{t('routers.tunnel.sharedNotReady')}</Alert>
    );
  }

  const showSteps = !server.ready || open;
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold text-slate-900">{t('routers.tunnel.title')}</h2>
          <p className="text-sm text-slate-600">{t('routers.tunnel.intro')}</p>
        </div>
        {server.ready ? (
          <span className="flex items-center gap-2">
            <Badge color="green">{t('routers.tunnel.ready')}</Badge>
            <span dir="ltr" className="text-sm text-slate-500">{server.relay_url?.replace(/^https:\/\//, '')}</span>
          </span>
        ) : (
          <span className="flex items-center gap-2">
            <Badge color="gray">{t('routers.tunnel.notSetUp')}</Badge>
            <Spinner className="h-4 w-4 text-slate-400" />
          </span>
        )}
      </div>

      {showSteps && (
        <div className="mt-3 space-y-2 text-sm text-slate-700">
          <ol className="list-decimal space-y-1 ps-5">
            <li>{rich(t('routers.tunnel.step1'), { ubuntu: <strong>Ubuntu</strong> })}</li>
            <li>
              {rich(t('routers.tunnel.step2'), {
                udp: <strong dir="ltr">UDP 51820</strong>,
                tcp: <strong>{t('routers.tunnel.tcpPorts')}</strong>,
              })}
            </li>
            <li>{t('routers.tunnel.step3')}</li>
          </ol>
          <div className="flex flex-wrap gap-2">
            <Button onClick={copy}>{copied ? t('common.copied') : t('routers.tunnel.copyInstall')}</Button>
          </div>
          <pre dir="ltr" className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-slate-900 p-3 text-xs text-slate-100">{server.command}</pre>
          <p className="text-xs text-slate-500">{rich(t('routers.tunnel.secretNote'), { ready: <strong>{t('routers.tunnel.ready')}</strong> })}</p>
          {server.ready && (
            <p className="text-xs text-slate-500">
              {rich(t('routers.tunnel.serverLine'), {
                endpoint: <bdi dir="ltr">{server.endpoint}</bdi>,
                relay: <bdi dir="ltr">{server.relay_url}</bdi>,
              })}
            </p>
          )}
        </div>
      )}
      {server.ready && (
        <button type="button" className={`${textButtonClass} -ms-2 mt-1 text-brand-700`} onClick={() => setOpen((v) => !v)}>
          {open ? t('routers.tunnel.hideInstall') : t('routers.tunnel.showInstall')}
        </button>
      )}
    </Card>
  );
}
