import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider';
import { supabase, supabaseConfigured } from '../../lib/supabase';
import { friendlyError } from '../../lib/errors';
import { homePathFor } from '../../lib/nav';
import { FullScreenSpinner } from '../../components/FullScreen';
import { Alert } from '../../components/ui';
import { LanguageSwitch } from '../../components/LanguageSwitch';
import { useT } from '../../i18n';

export function LoginPage() {
  const { status, profile, signIn } = useAuth();
  const { t } = useT();
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
    // Only a path inside this app: never "//host" or "/\host", which browsers treat as another site.
    const safe = from && /^\/(?![/\\])/.test(from) && from !== '/login';
    const target = safe ? from : profile ? homePathFor(profile.role) : '/';
    return <Navigate to={target} replace />;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await signIn(email.trim(), password);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('public.login.failed'));
    } finally {
      setBusy(false);
    }
  }

  async function handleReset(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      // The link brings the person back to this same address (www.hotzonex.net or an
      // earlier one), which must be listed under Redirect URLs in Supabase.
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
        <div className="mb-4 ms-auto max-w-xs">
          <LanguageSwitch tone="light" />
        </div>
        <div className="mb-6 flex flex-col items-center text-center">
          <img src="/logo.png" alt="Hotzonex WiFi" className="h-28 w-auto" />
          <h1 className="mt-3 text-2xl font-bold text-slate-900">Hotzonex Cloud</h1>
          <p className="text-slate-600">{t('public.login.subtitle')}</p>
        </div>

        {!supabaseConfigured && (
          <div className="mb-4">
            <Alert tone="warning">{t('public.login.notConfigured')}</Alert>
          </div>
        )}

        <form onSubmit={forgot ? handleReset : handleSubmit} className="space-y-4" noValidate>
          {forgot && !sentTo && <p className="text-sm text-slate-600">{t('public.login.forgotHelp')}</p>}
          {sentTo && (
            <Alert tone="success">{t('public.login.resetSent', { email: sentTo })}</Alert>
          )}
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">{t('public.login.email')}</span>
            <input
              type="email"
              dir="ltr"
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
              <span className="mb-1 block text-sm font-medium text-slate-700">{t('public.login.password')}</span>
              <input
                type="password"
                dir="ltr"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="min-h-12 w-full rounded-xl border border-slate-300 px-3 text-base focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
              />
            </label>
          )}

          {error && (
            <Alert tone="error">
              {error}
            </Alert>
          )}

          <button
            type="submit"
            disabled={busy || !email || (!forgot && !password) || Boolean(forgot && sentTo)}
            className="min-h-12 w-full rounded-xl bg-brand-600 px-4 text-lg font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {forgot ? (busy ? t('public.login.sending') : t('public.login.sendReset')) : busy ? t('public.login.loggingIn') : t('public.login.logIn')}
          </button>
          <button type="button" onClick={() => switchMode(!forgot)} className="w-full text-center text-sm font-semibold text-brand-700 hover:underline">
            {forgot ? t('public.login.backToLogin') : t('public.login.forgot')}
          </button>
        </form>
        <p className="mt-5 border-t border-slate-100 pt-4 text-center text-sm text-slate-600">
          {t('public.login.newBusiness')}{' '}
          <Link to="/signup" className="font-semibold text-brand-700 hover:underline">
            {t('public.login.startTrial')}
          </Link>
        </p>
        <p className="mt-2 text-center text-xs">
          <Link to="/terms" className="text-slate-500 hover:underline">
            {t('public.termsLink')}
          </Link>
        </p>
      </div>
    </div>
  );
}

/** The second step of the login: the 6-digit code from the authenticator app. */
function TwoStepCode() {
  const { reload, signOut } = useAuth();
  const { t } = useT();
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
      if (!factor) throw new Error(t('public.mfa.noFactor'));
      const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code: code.trim() });
      if (verifyError) throw new Error(/invalid|expired/i.test(verifyError.message) ? t('public.mfa.wrongCode') : verifyError.message);
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
          <h1 className="text-2xl font-bold text-slate-900">{t('public.mfa.title')}</h1>
          <p className="text-slate-600">{t('public.mfa.help')}</p>
        </div>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          dir="ltr"
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          className="min-h-14 w-full rounded-xl border border-slate-300 text-center font-mono text-3xl tracking-[0.4em] focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
        />
        {error && (
          <Alert tone="error">
            {error}
          </Alert>
        )}
        <button type="submit" disabled={busy || code.length !== 6} className="min-h-12 w-full rounded-xl bg-brand-600 text-lg font-semibold text-white disabled:opacity-50">
          {busy ? t('public.mfa.checking') : t('public.mfa.continue')}
        </button>
        <button type="button" onClick={() => void signOut()} className="w-full text-center text-sm font-semibold text-slate-600 hover:underline">
          {t('public.mfa.otherAccount')}
        </button>
      </form>
    </div>
  );
}
