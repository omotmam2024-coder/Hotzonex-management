import { Fragment, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../i18n';
import { friendlyError } from '../lib/errors';
import { formatNumber, timeAgo } from '../lib/format';
import { usePlans } from '../hooks/queries';
import { routerStatus } from '../lib/routers';
import { supabase } from '../lib/supabase';
import { ROUTER_COLUMNS, type HotspotInfo, type RouterInfo } from '../lib/types';
import { Alert, Badge, Button, Card, Spinner, textButtonClass } from './ui';

/**
 * A translated sentence with pieces of markup (bold words, commands in <code>) in it: each {name}
 * in the text is replaced by parts[name]. Commands and names stay untranslated inside the parts.
 */
export function rich(text: string, parts: Record<string, ReactNode>): ReactNode {
  return text.split(/(\{[a-zA-Z_]+\})/).map((piece, i) => {
    const name = /^\{([a-zA-Z_]+)\}$/.exec(piece)?.[1];
    return name !== undefined && name in parts ? <Fragment key={i}>{parts[name]}</Fragment> : piece;
  });
}

/** The router's setup script with plain steps and a copy button. */
export function SetupScriptCard({ script, kind = 'cloud' }: { script: string; kind?: 'cloud' | 'tunnel' }) {
  const [copied, setCopied] = useState(false);
  const { t } = useT();
  const pasteStep = rich(t('routers.setup.paste'), { terminal: <strong dir="ltr">New Terminal</strong>, enter: <strong dir="ltr">Enter</strong> });

  async function copy() {
    try {
      await navigator.clipboard.writeText(script);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } catch {
      setCopied(false);
      window.alert(t('routers.setup.copyBlocked'));
    }
  }

  if (kind === 'tunnel') {
    return (
      <Card>
        <h2 className="text-lg font-bold text-slate-900">{t('routers.setup.tunnelTitle')}</h2>
        <ol className="mt-2 list-decimal space-y-1 ps-5 text-sm text-slate-700">
          <li>{rich(t('routers.setup.clickBelow'), { button: <strong>{t('routers.setup.copyTunnel')}</strong> })}</li>
          <li>{pasteStep}</li>
          <li>{t('routers.setup.tunnelWait')}</li>
        </ol>
        <p className="mt-2 text-xs text-slate-500">
          {rich(t('routers.setup.tunnelNote'), {
            wg: <code dir="ltr">wg-hzc</code>,
            mark: <code dir="ltr">hotzonex-tunnel</code>,
            sched: <code dir="ltr">hzc-cloud</code>,
          })}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button onClick={copy}>{copied ? t('common.copied') : t('routers.setup.copyTunnel')}</Button>
        </div>
        <pre dir="ltr" className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-slate-900 p-3 text-xs leading-relaxed text-slate-100">{script}</pre>
      </Card>
    );
  }

  return (
    <Card>
      <h2 className="text-lg font-bold text-slate-900">{t('routers.setup.cloudTitle')}</h2>
      <ol className="mt-2 list-decimal space-y-1 ps-5 text-sm text-slate-700">
        <li>{rich(t('routers.setup.needsRos'), { ros: <strong>{t('routers.setup.rosVersion')}</strong> })}</li>
        <li>{rich(t('routers.setup.clickBelow'), { button: <strong>{t('routers.setup.copySetup')}</strong> })}</li>
        <li>{pasteStep}</li>
        <li>{t('routers.setup.cloudWait')}</li>
      </ol>
      <p className="mt-2 text-xs text-slate-500">{rich(t('routers.setup.cloudNote'), { sched: <code dir="ltr">hzc-cloud</code> })}</p>
      <p className="mt-1 text-xs text-slate-500">
        {rich(t('routers.setup.certNote'), { command: <code dir="ltr">/certificate settings set builtin-trust-anchors=trusted</code> })}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button onClick={copy}>{copied ? t('common.copied') : t('routers.setup.copySetup')}</Button>
      </div>
      <pre dir="ltr" className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-slate-900 p-3 text-xs leading-relaxed text-slate-100">{script}</pre>
    </Card>
  );
}

/** Live view of a router while it connects for the first time (or after a change). */
export function RouterConnectionStatus({ routerId, onEdit }: { routerId: string; onEdit?: () => void }) {
  const { t } = useT();
  const router = useQuery({
    queryKey: ['router', routerId],
    refetchInterval: 3000,
    queryFn: async (): Promise<RouterInfo | null> => {
      const { data, error } = await supabase.from('routers').select(ROUTER_COLUMNS).eq('id', routerId).maybeSingle();
      if (error) throw new Error(friendlyError(error));
      return data as RouterInfo | null;
    },
  });
  const r = router.data;
  if (!r) return null;

  const status = routerStatus(r);
  if (status === 'online') {
    return (
      <Alert tone="success">
        <strong>{t('routers.status.online', { name: r.name })}</strong>{' '}
        {t('routers.status.onlineLine', { model: r.model ?? '', ros: r.ros_version ?? '?', ago: timeAgo(r.last_seen_at) })}
      </Alert>
    );
  }
  if (r.last_error) {
    return (
      <Alert tone="error">
        <span className="block">{r.last_error}</span>
        {onEdit && (
          <button type="button" className={`${textButtonClass} -ms-2 mt-1 underline`} onClick={onEdit}>
            {t('routers.editRouter')}
          </button>
        )}
      </Alert>
    );
  }
  if (r.last_seen_at) {
    return (
      <Alert tone="info">
        <span className="flex items-center gap-2">
          <Spinner /> {t('routers.status.checking', { ago: timeAgo(r.last_seen_at) })}
        </span>
      </Alert>
    );
  }
  return (
    <Alert tone="info">
      <span className="flex items-center gap-2">
        <Spinner />{' '}
        {r.connection === 'tunnel' ? t('routers.status.waitTunnel') : t('routers.status.waitCloud')}
      </span>
    </Alert>
  );
}

/** What the router already has (read at its last check). Hotzonex uses this setup as it is. */
export function HotspotSnapshot({ info, hotspotServer }: { info: HotspotInfo; hotspotServer: string | null }) {
  const plans = usePlans();
  const { t, dir } = useT();
  const profiles = new Set(info.user_profiles.map((p) => p.name));
  const activePlans = (plans.data ?? []).filter((p) => p.is_active);
  return (
    <div className="space-y-3 text-sm">
      <p className="text-slate-600">
        {t('routers.snap.read', { ago: timeAgo(info.checked_at), users: formatNumber(info.users), active: formatNumber(info.active) })}
      </p>
      <div>
        <h3 className="font-semibold text-slate-800">{t('routers.snap.servers')}</h3>
        {info.servers.length === 0 ? (
          <p className="text-slate-600">{t('routers.snap.none')}</p>
        ) : (
          <ul className="mt-1 space-y-1">
            {info.servers.map((h) => {
              const prof = info.server_profiles.find((p) => p.name === h.profile);
              return (
                <li key={h.name} className="flex flex-wrap items-center gap-2">
                  <span className="font-mono font-medium">{h.name}</span>
                  {h.name === hotspotServer && <Badge color="green">{t('routers.snap.usedBy')}</Badge>}
                  {h.disabled && <Badge color="red">{t('routers.snap.disabled')}</Badge>}
                  <span className="text-slate-600">
                    {t('routers.snap.serverLine', { iface: h.interface || '—', pool: h.address_pool || '—', profile: h.profile || '—' })}
                    {prof ? ` · ${t('routers.snap.serverDns', { dns: prof.dns_name || '—', by: prof.login_by || '—' })}` : ''}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <div>
        <h3 className="font-semibold text-slate-800">{t('routers.snap.userProfiles')}</h3>
        <p className="mt-1 flex flex-wrap gap-1">
          {info.user_profiles.map((p) => (
            <span key={p.name} dir="ltr" className="rounded-lg bg-slate-100 px-2 py-0.5 font-mono text-xs">
              {p.name}
              {p.rate_limit ? ` · ${p.rate_limit}` : ''}
            </span>
          ))}
        </p>
      </div>
      {activePlans.length > 0 && (
        <div>
          <h3 className="font-semibold text-slate-800">{t('routers.snap.planMap')}</h3>
          <ul className="mt-1 space-y-0.5">
            {activePlans.map((p) => (
              <li key={p.id}>
                {p.name} {dir === 'rtl' ? '←' : '→'}{' '}
                <span dir="ltr" className="font-mono">
                  {p.router_profile_name}
                </span>{' '}
                {profiles.has(p.router_profile_name) ? (
                  <span className="text-green-700">{t('routers.snap.already')}</span>
                ) : (
                  <span className="text-amber-700">{t('routers.snap.adds')}</span>
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
  const { t } = useT();
  const router = useQuery({
    queryKey: ['router', routerId],
    refetchInterval: 5000,
    queryFn: async (): Promise<RouterInfo | null> => {
      const { data, error } = await supabase.from('routers').select(ROUTER_COLUMNS).eq('id', routerId).maybeSingle();
      if (error) throw new Error(friendlyError(error));
      return data as RouterInfo | null;
    },
  });
  const r = router.data;
  if (!r?.hotspot_info) return null;
  return (
    <Card>
      <h2 className="text-lg font-bold text-slate-900">{t('routers.snap.setupOn', { name: r.name })}</h2>
      <div className="mt-2">
        <HotspotSnapshot info={r.hotspot_info} hotspotServer={r.hotspot_server} />
      </div>
    </Card>
  );
}
