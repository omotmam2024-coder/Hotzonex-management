import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider';
import { friendlyError } from '../../lib/errors';
import { invokeFunction } from '../../lib/functions';
import { signupSchema, validate } from '../../lib/validation';
import { Alert } from '../../components/ui';
import { LanguageSwitch } from '../../components/LanguageSwitch';
import { ResendConfirmation } from '../../components/ResendConfirmation';
import { useT } from '../../i18n';

const input =
  'min-h-12 w-full rounded-xl border border-slate-300 px-3 text-base focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100';

/** Public: a new WiFi business starts its free trial; the owner confirms their email, then logs in. */
export function SignupPage() {
  const { status, session, signOut } = useAuth();
  const { t } = useT();
  const [sent, setSent] = useState<{ email: string; ok: boolean } | null>(null);
  const [form, setForm] = useState({ business_name: '', site_name: '', full_name: '', phone: '', email: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);


  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const v = validate(signupSchema, form);
      const res = await invokeFunction<{ email_sent?: boolean }>('signup', { ...v, timezone: 'Africa/Juba' });
      setSent({ email: v.email, ok: res.email_sent !== false });
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  const field = (k: keyof typeof form, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      <input value={form[k]} onChange={set(k)} className={input} {...props} />
    </label>
  );

  return (
    <div className="flex min-h-full items-center justify-center bg-gradient-to-br from-brand-700 via-brand-900 to-brand-950 p-4">
      <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl ring-1 ring-white/10 sm:p-8">
        <div className="mb-4 ms-auto max-w-xs">
          <LanguageSwitch tone="light" />
        </div>
        <div className="mb-5 text-center">
          <img src="/logo.png" alt="Hotzonex WiFi" className="mx-auto h-20 w-auto" />
          <h1 className="mt-3 text-2xl font-bold text-slate-900">{t('public.signup.title')}</h1>
          <p className="text-slate-600">{t('public.signup.subtitle')}</p>
        </div>
        {status === 'ready' && !sent ? (
          // Already logged in on this device: say so, rather than jumping to the dashboard.
          <div className="space-y-4 text-center">
            <p className="text-slate-700">{t('public.signup.loggedInAs', { email: session?.user.email ?? '' })}</p>
            <Link to="/" className="flex min-h-12 w-full items-center justify-center rounded-xl bg-brand-600 px-4 text-lg font-semibold text-white hover:bg-brand-700">
              {t('public.signup.openApp')}
            </Link>
            <button type="button" onClick={() => void signOut()} className="min-h-12 w-full rounded-xl px-4 font-semibold text-brand-700 ring-1 ring-brand-200 hover:bg-brand-50">
              {t('public.signup.logOutToSignUp')}
            </button>
          </div>
        ) : sent ? (
          <div className="space-y-4 text-center">
            <div className="text-6xl" aria-hidden>✉️</div>
            <h2 className="text-xl font-bold text-slate-900">{t('public.confirm.checkTitle')}</h2>
            <p className="text-slate-700">{t('public.confirm.checkText', { email: sent.email })}</p>
            {!sent.ok && <Alert tone="warning">{t('public.confirm.notSent')}</Alert>}
            <p className="text-sm text-slate-500">{t('public.confirm.spam')}</p>
            <ResendConfirmation email={sent.email} />
            <Link to="/login" className="block text-sm font-semibold text-brand-700 hover:underline">
              {t('public.confirm.toLogin')}
            </Link>
          </div>
        ) : (
        <form onSubmit={submit} className="space-y-3" noValidate>
          {field('business_name', t('public.signup.businessName'), { autoComplete: 'organization', required: true })}
          {field('site_name', t('public.signup.siteName'), { placeholder: t('public.signup.sitePlaceholder') })}
          {field('full_name', t('public.signup.fullName'), { autoComplete: 'name', required: true })}
          {field('phone', t('public.signup.phone'), { type: 'tel', dir: 'ltr', inputMode: 'tel', autoComplete: 'tel', required: true })}
          {field('email', t('public.signup.email'), { type: 'email', dir: 'ltr', inputMode: 'email', autoComplete: 'username', required: true })}
          {field('password', t('public.signup.password'), { type: 'password', dir: 'ltr', autoComplete: 'new-password', required: true })}
          {error && (
            <Alert tone="error">
              {error}
            </Alert>
          )}
          <button
            type="submit"
            disabled={busy || !form.business_name || !form.full_name || !form.phone || !form.email || form.password.length < 8}
            className="min-h-12 w-full rounded-xl bg-brand-600 px-4 text-lg font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {busy ? t('public.signup.creating') : t('public.startTrial')}
          </button>
          <p className="text-center text-xs text-slate-500">
            {t('public.signup.agreeBefore')}{' '}
            <Link to="/terms" className="font-semibold text-brand-700 underline">
              {t('public.signup.agreeLink')}
            </Link>
            {t('public.signup.agreeAfter')}
          </p>
          <p className="text-center text-sm text-slate-600">
            {t('public.signup.haveAccount')}{' '}
            <Link to="/login" className="font-semibold text-brand-700 hover:underline">
              {t('public.login.logIn')}
            </Link>
          </p>
        </form>
        )}
      </div>
    </div>
  );
}
