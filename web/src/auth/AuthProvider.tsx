import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { useQueryClient } from '@tanstack/react-query';
import { supabase, supabaseUrl } from '../lib/supabase';
import { friendlyError } from '../lib/errors';
import { readStored, writeStored } from '../lib/storage';
import type { Profile } from '../lib/types';

/** The business the signed-in staff member works for. */
export interface Business {
  id: string;
  name: string;
  timezone: string;
  is_active: boolean;
  /** Printed on cards and receipts; null prints the business name instead. */
  logo_url: string | null;
}

type AuthStatus = 'loading' | 'signed_out' | 'ready' | 'no_profile' | 'inactive' | 'error';

interface AuthContextValue {
  status: AuthStatus;
  session: Session | null;
  profile: Profile | null;
  siteName: string | null;
  business: Business | null;
  /** Runs Hotzonex Cloud itself: may add and switch off businesses. */
  isPlatformAdmin: boolean;
  error: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  /** everywhere: also ends this login on every other phone and computer. */
  signOut: (everywhere?: boolean) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

interface ProfileRow extends Profile {
  sites: { name: string } | null;
  tenants: Business | null;
}

/** The last signed-in account, kept so the app opens at once next time while it is checked again. */
interface CachedAccount {
  userId: string;
  profile: Profile;
  siteName: string | null;
  business: Business | null;
  isPlatformAdmin: boolean;
}
const ACCOUNT_KEY = 'hzc.account';

/** The user id of the login Supabase keeps in this browser (read without waiting for the network). */
function storedUserId(): string | null {
  try {
    const host = new URL(supabaseUrl).hostname.split('.')[0];
    const raw = window.localStorage.getItem(`sb-${host}-auth-token`);
    const id = raw ? (JSON.parse(raw) as { user?: { id?: unknown } }).user?.id : null;
    return typeof id === 'string' ? id : null;
  } catch {
    return null;
  }
}

/** The cached account, only when it belongs to the login stored in this browser and was usable. */
function cachedAccount(): CachedAccount | null {
  const cached = readStored<CachedAccount>('local', ACCOUNT_KEY);
  const userId = storedUserId();
  if (!cached || !userId || cached.userId !== userId) return null;
  if (!cached.profile?.is_active || !cached.business?.is_active) return null;
  return cached;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  // With a login and account from the last visit, the app opens straight away; both are checked
  // again in the background (what the account may see is still decided by the database).
  const [cached] = useState(cachedAccount);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(cached?.profile ?? null);
  const [siteName, setSiteName] = useState<string | null>(cached?.siteName ?? null);
  const [business, setBusiness] = useState<Business | null>(cached?.business ?? null);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(cached?.isPlatformAdmin ?? false);
  const queryClient = useQueryClient();
  const userRef = useRef<string | null | undefined>(cached ? cached.userId : undefined);
  const [status, setStatus] = useState<AuthStatus>(cached ? 'ready' : 'loading');
  const statusRef = useRef(status);
  statusRef.current = status;
  const [error, setError] = useState<string | null>(null);

  const loadProfile = useCallback(async (current: Session | null) => {
    // Another person on this device (or signed out): nothing cached from the previous one may show.
    const userId = current?.user.id ?? null;
    if (userRef.current !== undefined && userRef.current !== userId) {
      queryClient.clear();
      writeStored('session', 'hzc.lastSale', null);
    }
    userRef.current = userId;

    setSession(current);
    if (!current) {
      writeStored('local', ACCOUNT_KEY, null);
      writeStored('local', 'hzc.cache', null);
      setProfile(null);
      setSiteName(null);
      setBusiness(null);
      setIsPlatformAdmin(false);
      setStatus('signed_out');
      return;
    }
    const [{ data, error: queryError }, { data: platform }] = await Promise.all([
      supabase
        .from('profiles')
        .select('id, full_name, role, site_id, is_active, sites(name), tenants(id, name, timezone, is_active, logo_url)')
        .eq('id', current.user.id)
        .maybeSingle<ProfileRow>(),
      supabase.from('platform_admins').select('user_id').eq('user_id', current.user.id).maybeSingle(),
    ]);

    if (queryError) {
      // Already open from the last visit (e.g. a slow or broken connection): keep it open.
      if (statusRef.current === 'ready' && userRef.current === userId) return;
      setError(friendlyError(queryError));
      setStatus('error');
      return;
    }
    if (!data) {
      writeStored('local', ACCOUNT_KEY, null);
      setProfile(null);
      setStatus('no_profile');
      return;
    }
    const { sites, tenants, ...rest } = data;
    setProfile(rest);
    setSiteName(sites?.name ?? null);
    setBusiness(tenants);
    setIsPlatformAdmin(Boolean(platform));
    setError(null);
    writeStored('local', ACCOUNT_KEY, { userId: current.user.id, profile: rest, siteName: sites?.name ?? null, business: tenants, isPlatformAdmin: Boolean(platform) } satisfies CachedAccount);
    // A switched-off business can no longer read its own row, so a missing one counts as switched off.
    setStatus(rest.is_active && tenants?.is_active ? 'ready' : 'inactive');
  }, [queryClient]);

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled) void loadProfile(data.session);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      // Token refreshes keep the same user; no need to reload the profile.
      if (event === 'TOKEN_REFRESHED') {
        setSession(next);
        return;
      }
      // Defer so Supabase finishes its own state update before we query.
      setTimeout(() => {
        if (!cancelled) void loadProfile(next);
      }, 0);
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [loadProfile]);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError) throw new Error(friendlyError(signInError));
  }, []);

  const signOut = useCallback(async (everywhere = false) => {
    // Only an explicit true logs out everywhere (a button may pass its click event here).
    await supabase.auth.signOut({ scope: everywhere === true ? 'global' : 'local' });
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ status, session, profile, siteName, business, isPlatformAdmin, error, signIn, signOut }),
    [status, session, profile, siteName, business, isPlatformAdmin, error, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
