import { useQuery } from '@tanstack/react-query';
import { invokeFunction } from '../lib/functions';

interface TunnelServerInfo {
  ready: boolean;
  relay_url: string | null;
  endpoint: string | null;
  /** Only for platform admins: the command holds the shared tunnel server's secret. */
  command?: string;
}

/** Status of the admin's tunnel server (VPS); refreshes until it is ready. */
export function useTunnelServer() {
  return useQuery({
    queryKey: ['tunnel-server'],
    queryFn: () => invokeFunction<TunnelServerInfo>('add-router', { action: 'tunnel_server' }),
    refetchInterval: (q) => (q.state.data?.ready ? false : 10_000),
    staleTime: 30_000,
  });
}
