import { usePlans, useRouters, useSites } from './queries';

/** How far a new business is with its setup (used by the welcome page and the dashboard banner). */
export function useSetupProgress() {
  const routers = useRouters();
  const plans = usePlans();
  const sites = useSites();
  const loading = routers.isLoading || plans.isLoading || sites.isLoading;
  const routerList = routers.data ?? [];
  return {
    loading,
    hasSite: (sites.data ?? []).length > 0,
    hasRouter: routerList.length > 0,
    routerOnline: routerList.some((r) => r.status === 'online'),
    hasPlan: (plans.data ?? []).some((p) => p.is_active),
  };
}
