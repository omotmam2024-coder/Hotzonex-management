import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider';
import { friendlyError } from '../../lib/errors';
import { homePathFor } from '../../lib/nav';
import { supabase } from '../../lib/supabase';
import { Alert } from '../../components/ui';

type Stage = 'checking' | 'ready' | 'bad_link' | 'done';

const input =
  'min-h-12 w-full rounded-xl border border-slate-300 px-3 text-base focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100';

/**
 * Opened from the "reset your password" email. Supabase sends the person back here (the address
 * must be in Supabase → Authentication → URL Configuration) with a one-time login in the link;
 * it is used once to let them choose a new password.
 */
export function ResetPasswordPage() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [stage, setStage] = useState<Stage>('checking');
  const [linkError, setLinkError] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const query = new URLSearchParams(window.location.search);
    // The one-time login must not stay in the address bar or the browser history.
    window.history.replaceState(null, '', window.location.pathname);

    async function open() {
      const failure = hash.get('error_description') ?? query.get('error_description');
      if (failure) throw new Error(failure.replace(/\+/g, ' '));
      const accessToken = hash.get('access_token');
      const refreshToken = hash.get('refresh_token');
      const code = query.get('code');
      if (accessToken && refreshToken) {
        const { error: e } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
        if (e) throw e;
      } else if (code) {
        const { error: e } = await supabase.auth.exchangeCodeForSession(code);
        if (e) throw e;
      } else {
        const { data } = await supabase.auth.getSession();
        if (!data.session) throw new Error('This page only works from the link in the reset email.');
      }
    }

    open().then(
      () => !cancelled && setStage('ready'),
      (e: unknown) => {
        if (cancelled) return;
        setLinkError(friendlyError(e));
        setStage('bad_link');
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) return setError('Use at least 8 characters.');
    if (password.length > 72) return setError('Password is too long (max 72 characters).');
    if (password !== confirm) return setError('The two passwords are not the same.');
    setBusy(true);
    try {
      const { error: e2 } = await supabase.auth.updateUser({ password });
      if (e2) throw e2;
      setStage('done');
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-gradient-to-br from-brand-700 via-brand-900 to-brand-950 p-4">
      <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl ring-1 ring-white/10 sm:p-8">
        <div className="mb-6 flex flex-col items-center text-center">
          <img src="/logo.png" alt="Hotzonex WiFi" className="h-20 w-auto" />
          <h1 className="mt-3 text-2xl font-bold text-slate-900">New password</h1>
        </div>

        {stage === 'checking' && <p className="text-center text-slate-600">Checking the link…</p>}

        {stage === 'bad_link' && (
          <div className="space-y-4">
            <Alert tone="error">
              {linkError} Reset links work once and expire after an hour; ask for a new one.
            </Alert>
            <Link to="/login" className="block text-center font-semibold text-brand-700 hover:underline">
              Back to login
            </Link>
          </div>
        )}

        {stage === 'ready' && (
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-700">New password</span>
              <input type="password" autoComplete="new-password" minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} className={input} />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-700">Type it again</span>
              <input type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} className={input} />
            </label>
            {error && (
              <Alert tone="error">
                {error}
              </Alert>
            )}
            <button
              type="submit"
              disabled={busy || !password || !confirm}
              className="min-h-12 w-full rounded-xl bg-brand-600 px-4 text-lg font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? 'Saving…' : 'Save password'}
            </button>
          </form>
        )}

        {stage === 'done' && (
          <div className="space-y-4 text-center">
            <Alert tone="success">Your password is changed.</Alert>
            <button
              type="button"
              onClick={() => navigate(profile ? homePathFor(profile.role) : '/', { replace: true })}
              className="min-h-12 w-full rounded-xl bg-brand-600 px-4 text-lg font-semibold text-white hover:bg-brand-700"
            >
              Open Hotzonex
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
