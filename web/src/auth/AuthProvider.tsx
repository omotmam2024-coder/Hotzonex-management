import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { friendlyError } from '../lib/errors';
import type { Profile } from '../lib/types';

type AuthStatus = 'loading' | 'signed_out' | 'ready' | 'no_profile' | 'inactive' | 'error';

interface AuthContextValue {
  status: AuthStatus;
  session: Session | null;
  profile: Profile | null;
  siteName: string | null;
  error: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

interface ProfileRow extends Profile {
  sites: { name: string } | null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [siteName, setSiteName] = useState<string | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [error, setError] = useState<string | null>(null);

  const loadProfile = useCallback(async (current: Session | null) => {
    setSession(current);
    if (!current) {
      setProfile(null);
      setSiteName(null);
      setStatus('signed_out');
      return;
    }
    const { data, error: queryError } = await supabase
      .from('profiles')
      .select('id, full_name, role, site_id, is_active, sites(name)')
      .eq('id', current.user.id)
      .maybeSingle<ProfileRow>();

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
    const { sites, ...rest } = data;
    setProfile(rest);
    setSiteName(sites?.name ?? null);
    setError(null);
    setStatus(rest.is_active ? 'ready' : 'inactive');
  }, []);

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
    () => ({ status, session, profile, siteName, error, signIn, signOut }),
    [status, session, profile, siteName, error, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
