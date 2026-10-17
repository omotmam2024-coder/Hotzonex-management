import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { useQueryClient } from '@tanstack/react-query';
import { fromJson, supabase, supabaseUrl } from '../lib/supabase';
import { friendlyError } from '../lib/errors';
import { readStored, writeStored } from '../lib/storage';
import type { Profile } from '../lib/types';

/** The business the signed-in staff member works for. */
interface Business {
  id: string;
  name: string;
  timezone: string;
  is_active: boolean;
  /** Printed on cards and receipts; null prints the business name instead. */
  logo_url: string | null;
}

/** mfa: the password was right, the 2-step code is still to be typed. */
type AuthStatus = 'loading' | 'signed_out' | 'mfa' | 'ready' | 'no_profile' | 'inactive' | 'error';

/** A platform admin managing a customer's business (support mode). */
interface SupportSession {
  tenant_id: string;
  name: string;
  until: string;
}

interface AuthContextValue {
  status: AuthStatus;
  session: Session | null;
  profile: Profile | null;
  siteName: string | null;
  business: Business | null;
  /** Runs Hotzonex Cloud itself: may add and switch off businesses. */
  isPlatformAdmin: boolean;
  /** Logged in with the 2-step code (needed for platform powers). */
  twoStep: boolean;
  /** Set while a platform admin manages a customer's business. */
  support: SupportSession | null;
  /** Reloads the account (after starting or ending support mode, or the 2-step code). */
  reload: () => Promise<void>;
  error: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  /** everywhere: also ends this login on every other phone and computer. */
  signOut: (everywhere?: boolean) => Promise<void>;
}

type SupportedBusiness = SupportSession & { timezone: string; is_active: boolean; logo_url: string | null };

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
  const [twoStep, setTwoStep] = useState(false);
  const [support, setSupport] = useState<SupportSession | null>(null);
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
      setSupport(null);
      setTwoStep(false);
      setStatus('signed_out');
      return;
    }
    // A login with a 2-step code set up is only complete once the code is typed. The token is
    // passed so the 2-step codes are read from the server: the copy of the user kept in this
    // browser can be from before the code was set up, and the business would then look switched off.
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel(current.access_token);
    const level = aal?.currentLevel ?? 'aal1';
    setTwoStep(level === 'aal2');
    if (aal?.nextLevel === 'aal2' && level !== 'aal2') {
      setStatus('mfa');
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
    // Support mode: the platform admin works in the customer's business.
    const supporting: SupportedBusiness | null =
      platform && level === 'aal2' ? (fromJson<SupportedBusiness | null>((await supabase.rpc('support_session')).data) ?? null) : null;
    setSupport(supporting ? { tenant_id: supporting.tenant_id, name: supporting.name, until: supporting.until } : null);
    setProfile(rest);
    setSiteName(sites?.name ?? null);
    setBusiness(
      supporting
        ? { id: supporting.tenant_id, name: supporting.name, timezone: supporting.timezone, is_active: true, logo_url: supporting.logo_url }
        : tenants,
    );
    setIsPlatformAdmin(Boolean(platform));
    setError(null);
    writeStored('local', ACCOUNT_KEY, { userId: current.user.id, profile: rest, siteName: sites?.name ?? null, business: tenants, isPlatformAdmin: Boolean(platform) } satisfies CachedAccount);
    // A switched-off business can no longer read its own row, so a missing one counts as switched off.
    // Unless the 2-step code is still owed: the database hides the business until it is typed.
    if (!tenants && level !== 'aal2') {
      const { data: factors } = await supabase.auth.mfa.listFactors();
      if (factors?.totp.length) {
        setStatus('mfa');
        return;
      }
    }
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

  // Logged out after 8 hours without use (shared or lost phones). Activity is noted at most once a minute.
  useEffect(() => {
    if (!session) return;
    const KEY = 'hzc.lastActive';
    const IDLE_MS = 8 * 3600_000;
    const now = () => Date.now();
    // A fresh login counts as activity (the stored time may be from before it).
    const signedInAt = Date.parse(session.user.last_sign_in_at ?? '') || 0;
    const last = () => Math.max(Number(readStored<number>('local', KEY) ?? 0), signedInAt) || now();
    if (now() - last() > IDLE_MS) {
      void supabase.auth.signOut();
      return;
    }
    let noted = 0;
    const note = () => {
      if (now() - noted < 60_000) return;
      noted = now();
      writeStored('local', KEY, noted);
    };
    note();
    const events = ['pointerdown', 'keydown', 'visibilitychange'] as const;
    events.forEach((e) => window.addEventListener(e, note, { passive: true }));
    const timer = window.setInterval(() => {
      if (now() - last() > IDLE_MS) void supabase.auth.signOut();
    }, 60_000);
    return () => {
      events.forEach((e) => window.removeEventListener(e, note));
      window.clearInterval(timer);
    };
  }, [session]);

  const reload = useCallback(async () => {
    queryClient.clear();
    const { data } = await supabase.auth.refreshSession();
    await loadProfile(data.session);
  }, [loadProfile, queryClient]);

  // Support mode ends by itself (the database stops it at its end time): the app follows at once,
  // so the customer's name is never shown over the platform's own business.
  useEffect(() => {
    if (!support) return;
    const left = Date.parse(support.until) - Date.now();
    const timer = window.setTimeout(() => void reload(), Math.max(0, Math.min(left + 1000, 2 ** 31 - 1)));
    return () => window.clearTimeout(timer);
  }, [support, reload]);

  const value = useMemo<AuthContextValue>(
    () => ({ status, session, profile, siteName, business, isPlatformAdmin, twoStep, support, reload, error, signIn, signOut }),
    [status, session, profile, siteName, business, isPlatformAdmin, twoStep, support, reload, error, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
