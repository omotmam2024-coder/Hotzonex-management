import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider';
import { homePathFor } from '../../lib/nav';
import { LanguageSwitch } from '../../components/LanguageSwitch';
import { useT } from '../../i18n';

/** Shown for any address the app does not have (an old bookmark, a typo in a shared link). */
export function NotFoundPage() {
  const { profile } = useAuth();
  const { t } = useT();
  const home = profile ? homePathFor(profile.role) : '/login';
  return (
    <main className="flex min-h-full items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-sm rounded-3xl bg-white p-8 text-center shadow-sm ring-1 ring-slate-200">
        <div className="mb-4 ms-auto max-w-xs">
          <LanguageSwitch tone="light" />
        </div>
        <img src="/logo.png" alt="Hotzonex WiFi" className="mx-auto h-16 w-auto" />
        <p className="mt-6 text-5xl font-bold text-brand-700">404</p>
        <h1 className="mt-2 text-xl font-bold text-slate-900">{t('public.notFound.title')}</h1>
        <p className="mt-2 text-slate-600">{t('public.notFound.text')}</p>
        <Link
          to={home}
          replace
          className="mt-6 flex min-h-12 items-center justify-center rounded-xl bg-brand-600 px-4 text-lg font-semibold text-white hover:bg-brand-700"
        >
          {profile ? t('public.notFound.dashboard') : t('public.notFound.login')}
        </Link>
      </div>
    </main>
  );
}
