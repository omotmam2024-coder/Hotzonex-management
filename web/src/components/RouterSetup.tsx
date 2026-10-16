import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatNumber, timeAgo } from '../lib/format';
import { usePlans } from '../hooks/queries';
import { routerStatus } from '../lib/routers';
import { supabase } from '../lib/supabase';
import { ROUTER_COLUMNS, type HotspotInfo, type RouterInfo } from '../lib/types';
import { Alert, Badge, Button, Card, Spinner } from './ui';

/** The router's setup script with plain steps and a copy button. */
export function SetupScriptCard({ script, kind = 'cloud' }: { script: string; kind?: 'cloud' | 'tunnel' }) {
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

  if (kind === 'tunnel') {
    return (
      <Card>
        <h2 className="text-lg font-bold text-slate-900">Connect the router through your tunnel server</h2>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-slate-700">
          <li>Click <strong>Copy tunnel script</strong> below.</li>
          <li>
            In Winbox click <strong>New Terminal</strong>, paste (right-click → Paste, or Ctrl+V) and press <strong>Enter</strong>.
          </li>
          <li>Wait here. Hotzonex checks the router through the tunnel within a minute.</li>
        </ol>
        <p className="mt-2 text-xs text-slate-500">
          Nothing is scheduled on the router. The script checks that your hotspot is running, then adds only a WireGuard interface <code>wg-hzc</code> with one
          peer (your tunnel server), its address and one firewall rule letting the tunnel server reach the www service. All three are marked{' '}
          <code>hotzonex-tunnel</code>. It removes the old <code>hzc-cloud</code> scheduler and script if they are there. Your hotspot, its profiles and
          MikroTicket are not touched. The script contains this router’s tunnel key, so do not share it. Pasting it again is safe.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button onClick={copy}>{copied ? 'Copied ✓' : 'Copy tunnel script'}</Button>
        </div>
        <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-slate-900 p-3 text-xs leading-relaxed text-slate-100">{script}</pre>
      </Card>
    );
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
        The script only adds a script and a scheduler named <code>hzc-cloud</code>; it changes no other router setting. No computer, VPN or public IP is
        needed. The script contains this router’s secret key, so do not share it. Pasting it again is safe.
      </p>
      <p className="mt-1 text-xs text-slate-500">
        If the router stays “Waiting” after an upgrade from an older RouterOS, it may not trust certificates yet. You can allow that yourself with{' '}
        <code>/certificate settings set builtin-trust-anchors=trusted</code>.
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
        <Spinner />{' '}
        {r.connection === 'tunnel'
          ? 'Waiting for the router to connect through the tunnel. Paste the tunnel script into its terminal.'
          : 'Waiting for the router to call in. Paste the setup script into its terminal.'}
      </span>
    </Alert>
  );
}

/** What the router already has (read at its last check). Hotzonex uses this setup as it is. */
export function HotspotSnapshot({ info, hotspotServer }: { info: HotspotInfo; hotspotServer: string | null }) {
  const plans = usePlans();
  const profiles = new Set(info.user_profiles.map((p) => p.name));
  const activePlans = (plans.data ?? []).filter((p) => p.is_active);
  return (
    <div className="space-y-3 text-sm">
      <p className="text-slate-600">
        Read from the router {timeAgo(info.checked_at)} · {formatNumber(info.users)} hotspot users · {formatNumber(info.active)} online. Hotzonex uses this setup
        as it is and does not change it.
      </p>
      <div>
        <h3 className="font-semibold text-slate-800">Hotspot servers</h3>
        {info.servers.length === 0 ? (
          <p className="text-slate-600">None. Create the hotspot on the router (Winbox → IP → Hotspot → Hotspot Setup).</p>
        ) : (
          <ul className="mt-1 space-y-1">
            {info.servers.map((h) => {
              const prof = info.server_profiles.find((p) => p.name === h.profile);
              return (
                <li key={h.name} className="flex flex-wrap items-center gap-2">
                  <span className="font-mono font-medium">{h.name}</span>
                  {h.name === hotspotServer && <Badge color="green">used by Hotzonex</Badge>}
                  {h.disabled && <Badge color="red">disabled</Badge>}
                  <span className="text-slate-600">
                    on {h.interface || '—'} · pool {h.address_pool || '—'} · profile {h.profile || '—'}
                    {prof ? ` · DNS ${prof.dns_name || '—'} · login by ${prof.login_by || '—'}` : ''}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <div>
        <h3 className="font-semibold text-slate-800">User profiles on the router</h3>
        <p className="mt-1 flex flex-wrap gap-1">
          {info.user_profiles.map((p) => (
            <span key={p.name} className="rounded-lg bg-slate-100 px-2 py-0.5 font-mono text-xs">
              {p.name}
              {p.rate_limit ? ` · ${p.rate_limit}` : ''}
            </span>
          ))}
        </p>
      </div>
      {activePlans.length > 0 && (
        <div>
          <h3 className="font-semibold text-slate-800">Hotzonex plans → user profile on the router</h3>
          <ul className="mt-1 space-y-0.5">
            {activePlans.map((p) => (
              <li key={p.id}>
                {p.name} → <span className="font-mono">{p.router_profile_name}</span>{' '}
                {profiles.has(p.router_profile_name) ? (
                  <span className="text-green-700">(already on the router — used, not changed)</span>
                ) : (
                  <span className="text-amber-700">(Hotzonex adds it to the router)</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Loads a router and shows its hotspot snapshot, if one has been read. */
export function HotspotSetup({ routerId }: { routerId: string }) {
  const router = useQuery({
    queryKey: ['router', routerId],
    refetchInterval: 5000,
    queryFn: async (): Promise<RouterInfo | null> => {
      const { data, error } = await supabase.from('routers').select(ROUTER_COLUMNS).eq('id', routerId).maybeSingle();
      if (error) throw new Error(error.message);
      return data as RouterInfo | null;
    },
  });
  const r = router.data;
  if (!r?.hotspot_info) return null;
  return (
    <Card>
      <h2 className="text-lg font-bold text-slate-900">Hotspot setup on {r.name}</h2>
      <div className="mt-2">
        <HotspotSnapshot info={r.hotspot_info} hotspotServer={r.hotspot_server} />
      </div>
    </Card>
  );
}
