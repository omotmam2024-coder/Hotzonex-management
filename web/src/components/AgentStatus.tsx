import { useQuery } from '@tanstack/react-query';
import { formatJubaTime, timeAgo } from '../lib/format';
import { supabase } from '../lib/supabase';
import { Alert } from './ui';

export interface AgentRow {
  id: string;
  hostname: string;
  last_seen_at: string;
  version: string | null;
  lan_addresses: string[];
}

/** An agent reports every 20 s; after 90 s of silence it counts as stopped. */
const STALE_MS = 90_000;

export type AgentState =
  | { kind: 'loading' }
  | { kind: 'never' }
  | { kind: 'stopped'; agent: AgentRow }
  | { kind: 'online'; agent: AgentRow };

export function useAgentState(): AgentState {
  const q = useQuery({
    queryKey: ['agent-status'],
    refetchInterval: 15_000,
    queryFn: async (): Promise<AgentRow[]> => {
      const { data, error } = await supabase
        .from('agent_status')
        .select('id, hostname, last_seen_at, version, lan_addresses')
        .order('last_seen_at', { ascending: false })
        .limit(5);
      if (error) throw new Error(error.message);
      return (data ?? []) as AgentRow[];
    },
  });
  if (q.isLoading || !q.data) return { kind: 'loading' };
  const latest = q.data[0];
  if (!latest) return { kind: 'never' };
  return Date.now() - new Date(latest.last_seen_at).getTime() > STALE_MS ? { kind: 'stopped', agent: latest } : { kind: 'online', agent: latest };
}

/** "192.168.120.1" and "192.168.120.23" share "192.168.120." — a rough same-network check for LAN setups. */
function sameSubnet24(a: string, b: string): boolean {
  return a.split('.').slice(0, 3).join('.') === b.split('.').slice(0, 3).join('.');
}

/** Plain-language explanation of what the agent state means for testing a router. */
export function agentProblem(state: AgentState, routerIp?: string): string | null {
  if (state.kind === 'never') {
    return (
      'No Router Agent has connected yet, so routers cannot be tested. Being online on this computer is not enough: ' +
      'the website cannot reach a private router address over the internet. The Router Agent program must be installed and ' +
      `running on a computer on the same network as the router${routerIp ? ` (${routerIp})` : ''}. See README step 3: ` +
      'copy agent/.env.example to .env, fill in the Supabase URL, service_role key and ROUTER_SECRET_KEY, then run npm install, npm run check and npm start.'
    );
  }
  if (state.kind === 'stopped') {
    return (
      `The Router Agent on "${state.agent.hostname}" stopped — last seen ${formatJubaTime(state.agent.last_seen_at)}. ` +
      'Start it again on that computer (npm start in the agent folder, or sudo systemctl start hotzonex-agent / pm2 restart hotzonex-agent).'
    );
  }
  return null;
}

export function AgentStatusBanner({ routerIp }: { routerIp?: string }) {
  const state = useAgentState();
  if (state.kind === 'loading') return null;

  const problem = agentProblem(state, routerIp);
  if (problem) {
    return (
      <Alert tone={state.kind === 'never' ? 'warning' : 'error'}>
        <strong>{state.kind === 'never' ? 'Router Agent not connected' : 'Router Agent stopped'}.</strong> {problem}
      </Alert>
    );
  }

  if (state.kind !== 'online') return null;
  const { agent } = state;
  const addresses = agent.lan_addresses.length ? agent.lan_addresses.join(', ') : 'unknown';
  const offNetwork = routerIp && agent.lan_addresses.length > 0 && !agent.lan_addresses.some((a) => sameSubnet24(a, routerIp));
  return (
    <div className="space-y-2">
      <Alert tone="success">
        <strong>Router Agent online</strong> on “{agent.hostname}” · network address {addresses} · seen {timeAgo(agent.last_seen_at)}
      </Alert>
      {offNetwork && (
        <Alert tone="warning">
          The agent computer’s address ({addresses}) is not on the router’s network ({routerIp?.split('.').slice(0, 3).join('.')}.x). Unless your networks are routed
          to each other, run the agent on a computer connected to the router itself.
        </Alert>
      )}
    </div>
  );
}
