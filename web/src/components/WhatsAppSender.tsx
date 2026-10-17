import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Badge, Button, Card, Spinner } from './ui';
import { friendlyError } from '../lib/errors';
import { invokeFunction } from '../lib/functions';
import type { WhatsAppStatus } from '../lib/whatsapp';

/**
 * Platform admins: Hotzonex Cloud's WhatsApp sender (a second SIM linked to the tunnel server, like
 * WhatsApp Web). Install it with one command, scan the QR code with the sender phone, done.
 */
export function WhatsAppSender() {
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
      window.alert('Copying was blocked by the browser. Select the command and copy it with Ctrl+C.');
    }
  }

  const s = status.data;
  const error = setup.error ?? logout.error;
  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold">WhatsApp sender</h2>
        {s && (s.connected ? <Badge color="green">Connected</Badge> : s.installed ? <Badge color="red">Not connected</Badge> : <Badge color="gray">Not set up</Badge>)}
      </div>
      <p className="text-sm text-slate-600">
        Alerts are sent from a normal WhatsApp number, linked to your tunnel server like WhatsApp Web (no API key). Use a separate SIM for this, not
        your personal number: this way of sending is unofficial, and WhatsApp can block a number it thinks is a bot.
      </p>

      {status.isLoading && <Spinner />}
      {status.error && <Alert tone="error">{friendlyError(status.error)}</Alert>}

      {s?.connected && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-slate-700">
            Sending from <b>{s.sender ?? 'the linked phone'}</b>. Keep that phone charged and online at least once every two weeks.
          </p>
          <Button
            variant="danger"
            onClick={() => window.confirm('Unlink the sender phone? WhatsApp alerts stop until you scan a new QR code.') && logout.mutate()}
            disabled={logout.isPending}
          >
            {logout.isPending && <Spinner />} Unlink phone
          </Button>
        </div>
      )}

      {s?.installed && !s.connected && s.qr && (
        <div className="flex flex-col items-start gap-3 sm:flex-row">
          <img src={s.qr} alt="QR code to link the WhatsApp sender" className="h-56 w-56 rounded-xl bg-white p-2 ring-1 ring-slate-200" />
          <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-700">
            <li>Take the sender phone (the second SIM).</li>
            <li>
              Open WhatsApp → <b>Settings</b> (or ⋮) → <b>Linked devices</b> → <b>Link a device</b>.
            </li>
            <li>Point the camera at this code. It changes every few seconds; this page follows it.</li>
          </ol>
        </div>
      )}
      {s?.installed && !s.connected && !s.qr && (
        <Alert tone="warning">
          {s.reachable === false
            ? `The sender on the tunnel server cannot be reached${s.error ? ` (${s.error})` : ''}. Run the install command on the VPS again.`
            : 'The sender is starting or reconnecting. Wait a minute; a QR code appears here if the phone needs to be linked again.'}
        </Alert>
      )}

      {(!s?.installed || s.reachable === false || command) && (
        <div className="space-y-2">
          {!command ? (
            <Button onClick={() => setup.mutate()} disabled={setup.isPending}>
              {setup.isPending && <Spinner />} {s?.installed ? 'Show install command again' : 'Set up WhatsApp sender'}
            </Button>
          ) : (
            <>
              <p className="text-sm text-slate-700">
                Log in to the tunnel server (VPS), paste this command and press Enter. It takes 1–3 minutes. Then scan the QR code that appears here.
              </p>
              <Button onClick={copy}>{copied ? 'Copied ✓' : 'Copy install command'}</Button>
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-slate-900 p-3 text-xs text-slate-100">{command}</pre>
              <p className="text-xs text-slate-500">The command contains the sender's secret: do not share it. Running it again is safe.</p>
            </>
          )}
        </div>
      )}
      {error && <Alert tone="error">{friendlyError(error)}</Alert>}
    </Card>
  );
}
