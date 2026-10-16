import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider';
import { supabase, supabaseConfigured } from '../../lib/supabase';
import { friendlyError } from '../../lib/errors';
import { homePathFor } from '../../lib/nav';
import { FullScreenSpinner } from '../../components/FullScreen';

export function LoginPage() {
  const { status, profile, signIn } = useAuth();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forgot, setForgot] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  if (status === 'loading') return <FullScreenSpinner />;
  if (status === 'mfa') return <TwoStepCode />;
  if (status !== 'signed_out') {
    const from = (location.state as { from?: string } | null)?.from;
    const target = from && from !== '/login' ? from : profile ? homePathFor(profile.role) : '/';
    return <Navigate to={target} replace />;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await signIn(email.trim(), password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function handleReset(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      // The link brings the person back to this same address (app.hotzonex.net or the
      // DigitalOcean one), which must be listed under Redirect URLs in Supabase.
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (resetError) throw resetError;
      setSentTo(email.trim());
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  function switchMode(next: boolean) {
    setForgot(next);
    setSentTo(null);
    setError(null);
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-gradient-to-br from-brand-700 via-brand-900 to-brand-950 p-4">
      <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl ring-1 ring-white/10 sm:p-8">
        <div className="mb-6 flex flex-col items-center text-center">
          <img src="/logo.png" alt="Hotzonex WiFi" className="h-28 w-auto" />
          <h1 className="mt-3 text-2xl font-bold text-slate-900">Hotzonex Cloud</h1>
          <p className="text-slate-600">Staff login</p>
        </div>

        {!supabaseConfigured && (
          <div className="mb-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
            The app is not connected to Supabase. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in web/.env.
          </div>
        )}

        <form onSubmit={forgot ? handleReset : handleSubmit} className="space-y-4" noValidate>
          {forgot && !sentTo && <p className="text-sm text-slate-600">Type your login email. We will send you a link to choose a new password.</p>}
          {sentTo && (
            <p role="status" className="rounded-xl bg-green-50 p-3 text-sm font-medium text-green-800">
              If {sentTo} has a Hotzonex login, a reset link is on its way. Check the inbox (and spam) and open the link on this device.
            </p>
          )}
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">Email</span>
            <input
              type="email"
              autoComplete="username"
              inputMode="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="min-h-12 w-full rounded-xl border border-slate-300 px-3 text-base focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
            />
          </label>
          {!forgot && (
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-700">Password</span>
              <input
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="min-h-12 w-full rounded-xl border border-slate-300 px-3 text-base focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
              />
            </label>
          )}

          {error && (
            <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm font-medium text-red-800">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy || !email || (!forgot && !password) || Boolean(forgot && sentTo)}
            className="min-h-12 w-full rounded-xl bg-brand-600 px-4 text-lg font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {forgot ? (busy ? 'Sending…' : 'Send reset link') : busy ? 'Logging in…' : 'Log in'}
          </button>
          <button type="button" onClick={() => switchMode(!forgot)} className="w-full text-center text-sm font-semibold text-brand-700 hover:underline">
            {forgot ? 'Back to login' : 'Forgot password?'}
          </button>
        </form>
        <p className="mt-5 border-t border-slate-100 pt-4 text-center text-sm text-slate-600">
          New WiFi business?{' '}
          <Link to="/signup" className="font-semibold text-brand-700 hover:underline">
            Start a free trial
          </Link>
        </p>
        <p className="mt-2 text-center text-xs">
          <Link to="/terms" className="text-slate-500 hover:underline">
            Terms and privacy
          </Link>
        </p>
      </div>
    </div>
  );
}

/** The second step of the login: the 6-digit code from the authenticator app. */
function TwoStepCode() {
  const { reload, signOut } = useAuth();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function verify(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { data, error: listError } = await supabase.auth.mfa.listFactors();
      if (listError) throw listError;
      const factor = data.totp.find((f) => f.status === 'verified');
      if (!factor) throw new Error('No authenticator app is set up for this login.');
      const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code: code.trim() });
      if (verifyError) throw new Error(/invalid|expired/i.test(verifyError.message) ? 'Wrong or expired code. Type the newest code from your app.' : verifyError.message);
      await reload();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-gradient-to-br from-brand-700 via-brand-900 to-brand-950 p-4">
      <form onSubmit={verify} className="w-full max-w-sm space-y-4 rounded-3xl bg-white p-6 shadow-2xl ring-1 ring-white/10 sm:p-8" noValidate>
        <div className="text-center">
          <h1 className="text-2xl font-bold text-slate-900">2-step login</h1>
          <p className="text-slate-600">Type the 6-digit code from your authenticator app.</p>
        </div>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          className="min-h-14 w-full rounded-xl border border-slate-300 text-center font-mono text-3xl tracking-[0.4em] focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
        />
        {error && (
          <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm font-medium text-red-800">
            {error}
          </p>
        )}
        <button type="submit" disabled={busy || code.length !== 6} className="min-h-12 w-full rounded-xl bg-brand-600 text-lg font-semibold text-white disabled:opacity-50">
          {busy ? 'Checking…' : 'Continue'}
        </button>
        <button type="button" onClick={() => void signOut()} className="w-full text-center text-sm font-semibold text-slate-600 hover:underline">
          Use another account
        </button>
      </form>
    </div>
  );
}
