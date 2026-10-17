import { useState } from 'react';
import { useTunnelServer } from '../hooks/useTunnelServer';
import { friendlyError } from '../lib/errors';
import { Alert, Badge, Button, Card, Spinner, textButtonClass } from './ui';

/** Explains the tunnel server and gives the one install command for the VPS. */
export function TunnelServerCard() {
  const tunnel = useTunnelServer();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const t = tunnel.data;

  async function copy() {
    if (!t?.command) return;
    try {
      await navigator.clipboard.writeText(t.command);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } catch {
      window.alert('Copying was blocked by the browser. Select the command and copy it with Ctrl+C.');
    }
  }

  if (tunnel.isLoading) return null;
  if (tunnel.error) return <Alert tone="error">Tunnel server: {friendlyError(tunnel.error)}</Alert>;
  if (!t) return null;

  // Businesses use the shared tunnel server that Hotzonex Cloud runs; only its platform admins install it.
  if (!t.command) {
    return t.ready ? null : (
      <Alert tone="info">
        Routers without a public IP connect through the Hotzonex Cloud tunnel server, which is not ready yet. Contact Hotzonex Cloud before adding such a
        router.
      </Alert>
    );
  }

  const showSteps = !t.ready || open;
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Tunnel server</h2>
          <p className="text-sm text-slate-600">
            For routers without a public IP. Each router keeps a WireGuard tunnel to your own small server, so nothing is scheduled on the router.
          </p>
        </div>
        {t.ready ? (
          <span className="flex items-center gap-2">
            <Badge color="green">Ready</Badge>
            <span className="text-sm text-slate-500">{t.relay_url?.replace(/^https:\/\//, '')}</span>
          </span>
        ) : (
          <span className="flex items-center gap-2">
            <Badge color="gray">Not set up</Badge>
            <Spinner className="h-4 w-4 text-slate-400" />
          </span>
        )}
      </div>

      {showSteps && (
        <div className="mt-3 space-y-2 text-sm text-slate-700">
          <ol className="list-decimal space-y-1 pl-5">
            <li>
              Rent the smallest <strong>Ubuntu</strong> VPS from any provider (Hetzner, DigitalOcean, Vultr…, about US$4–6 a month). One server serves all
              your routers.
            </li>
            <li>
              In the provider’s firewall (if it has one) allow <strong>UDP 51820</strong> and <strong>TCP 80 and 443</strong>.
            </li>
            <li>
              Log in to the VPS (the provider’s web console or SSH), paste this command and press Enter. It takes 1–3 minutes.
            </li>
          </ol>
          <div className="flex flex-wrap gap-2">
            <Button onClick={copy}>{copied ? 'Copied ✓' : 'Copy install command'}</Button>
          </div>
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-slate-900 p-3 text-xs text-slate-100">{t.command}</pre>
          <p className="text-xs text-slate-500">
            The command contains your tunnel server’s secret: do not share it. It installs WireGuard and an HTTPS relay (Caddy, free certificate) that only
            forwards Hotzonex’s requests to your routers’ REST API; each request still needs the router’s own username and password. This card turns{' '}
            <strong>Ready</strong> by itself when the server has registered. Running the command again is safe.
          </p>
          {t.ready && <p className="text-xs text-slate-500">Server: {t.endpoint} · relay {t.relay_url}</p>}
        </div>
      )}
      {t.ready && (
        <button type="button" className={`${textButtonClass} -ml-2 mt-1 text-brand-700`} onClick={() => setOpen((v) => !v)}>
          {open ? 'Hide install command' : 'Show install command'}
        </button>
      )}
    </Card>
  );
}
