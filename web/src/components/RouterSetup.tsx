import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { timeAgo } from '../lib/format';
import { routerStatus } from '../lib/routers';
import { supabase } from '../lib/supabase';
import { ROUTER_COLUMNS, type RouterInfo } from '../lib/types';
import { Alert, Button, Card, Spinner } from './ui';

/** The router's setup script with plain steps and a copy button. */
export function SetupScriptCard({ script }: { script: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(script);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } catch {
      setCopied(false);
      window.alert('Copying was blocked by the browser. Select the text in the box and copy it with Ctrl+C.');
    }
  }

  return (
    <Card>
      <h2 className="text-lg font-bold text-slate-900">Connect the router to Hotzonex Cloud</h2>
      <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-slate-700">
        <li>
          The router needs <strong>RouterOS 7.19 or newer</strong> and internet access. To update: Winbox → System → Packages → Check For Updates.
        </li>
        <li>Click <strong>Copy setup script</strong> below.</li>
        <li>
          In Winbox click <strong>New Terminal</strong>, paste (right-click → Paste, or Ctrl+V) and press <strong>Enter</strong>.
        </li>
        <li>Wait here. The router calls Hotzonex Cloud every 30 seconds and shows Online within a minute.</li>
      </ol>
      <p className="mt-2 text-xs text-slate-500">
        No computer, VPN or public IP is needed: the router connects out to Hotzonex Cloud over HTTPS. The script contains this router’s secret key, so do not
        share it. Pasting it again is safe.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button onClick={copy}>{copied ? 'Copied ✓' : 'Copy setup script'}</Button>
      </div>
      <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-slate-900 p-3 text-xs leading-relaxed text-slate-100">{script}</pre>
    </Card>
  );
}

/** Live view of a router while it connects for the first time (or after a change). */
export function RouterConnectionStatus({ routerId, onEdit }: { routerId: string; onEdit?: () => void }) {
  const router = useQuery({
    queryKey: ['router', routerId],
    refetchInterval: 3000,
    queryFn: async (): Promise<RouterInfo | null> => {
      const { data, error } = await supabase.from('routers').select(ROUTER_COLUMNS).eq('id', routerId).maybeSingle();
      if (error) throw new Error(error.message);
      return data as RouterInfo | null;
    },
  });
  const r = router.data;
  if (!r) return null;

  const status = routerStatus(r);
  if (status === 'online') {
    return (
      <Alert tone="success">
        <strong>{r.name} is online.</strong> {r.model ?? ''} · RouterOS {r.ros_version ?? '?'} · last call {timeAgo(r.last_seen_at)}
      </Alert>
    );
  }
  if (r.last_error) {
    return (
      <Alert tone="error">
        <span className="block">{r.last_error}</span>
        {onEdit && (
          <button type="button" className="mt-2 font-semibold underline" onClick={onEdit}>
            Edit router
          </button>
        )}
      </Alert>
    );
  }
  if (r.last_seen_at) {
    return (
      <Alert tone="info">
        <span className="flex items-center gap-2">
          <Spinner /> The router is connected (last call {timeAgo(r.last_seen_at)}) and is being checked…
        </span>
      </Alert>
    );
  }
  return (
    <Alert tone="info">
      <span className="flex items-center gap-2">
        <Spinner /> Waiting for the router to call in. Paste the setup script into its terminal.
      </span>
    </Alert>
  );
}
