import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { friendlyError } from '../lib/errors';
import { writeStored } from '../lib/storage';
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
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

interface ProfileRow extends Profile {
  sites: { name: string } | null;
  tenants: Business | null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [siteName, setSiteName] = useState<string | null>(null);
  const [business, setBusiness] = useState<Business | null>(null);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const queryClient = useQueryClient();
  const userRef = useRef<string | null | undefined>(undefined);
  const [status, setStatus] = useState<AuthStatus>('loading');
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
      setError(friendlyError(queryError));
      setStatus('error');
      return;
    }
    if (!data) {
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

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
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
