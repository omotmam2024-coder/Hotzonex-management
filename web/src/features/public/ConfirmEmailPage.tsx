import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { friendlyError } from '../../lib/errors';
import { supabase } from '../../lib/supabase';
import { FullScreenSpinner } from '../../components/FullScreen';
import { Alert } from '../../components/ui';
import { LanguageSwitch } from '../../components/LanguageSwitch';
import { translate, useT } from '../../i18n';

/**
 * Opened from the "confirm your email" message sent at sign-up. Supabase confirms the address and
 * sends the owner back here (the address must be in Supabase → Authentication → URL Configuration)
 * with a one-time login, which opens the app straight away.
 */
export function ConfirmEmailPage() {
  const { t } = useT();
  const navigate = useNavigate();
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
        throw new Error(translate('public.confirm.onlyFromLink'));
      }
    }

    open().then(
      () => !cancelled && navigate('/welcome', { replace: true }),
      (e: unknown) => !cancelled && setError(friendlyError(e)),
    );
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  if (!error) return <FullScreenSpinner />;
  return (
    <div className="flex min-h-full items-center justify-center bg-gradient-to-br from-brand-700 via-brand-900 to-brand-950 p-4">
      <div className="w-full max-w-sm space-y-4 rounded-3xl bg-white p-6 shadow-2xl ring-1 ring-white/10 sm:p-8">
        <div className="ms-auto max-w-xs">
          <LanguageSwitch tone="light" />
        </div>
        <h1 className="text-center text-2xl font-bold text-slate-900">{t('public.confirm.badTitle')}</h1>
        <Alert tone="error">{error}</Alert>
        <p className="text-slate-700">{t('public.confirm.badHelp')}</p>
        <Link to="/login" className="flex min-h-12 w-full items-center justify-center rounded-xl bg-brand-600 px-4 text-lg font-semibold text-white hover:bg-brand-700">
          {t('public.login.logIn')}
        </Link>
      </div>
    </div>
  );
}
