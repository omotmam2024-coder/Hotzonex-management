import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './AuthProvider';
import { BillingPanel } from '../components/BillingPanel';
import { useBillingOverview } from '../hooks/useBillingOverview';
import { FullScreenMessage, FullScreenSpinner } from '../components/FullScreen';
import { useT } from '../i18n';

/** Lets only signed-in, active staff with a profile through. */
export function RequireAuth() {
  const { status, profile, error, signOut } = useAuth();
  const { t } = useT();
  const location = useLocation();

  if (status === 'loading') return <FullScreenSpinner />;
  if (status === 'signed_out' || status === 'mfa') return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (status === 'no_profile')
    return (
      <FullScreenMessage
        title={t('public.auth.notSetUpTitle')}
        message={t('public.auth.notSetUpText')}
        onSignOut={signOut}
      />
    );
  // An admin of a business paused for an unpaid invoice can still see it and send the payment.
  if (status === 'inactive' && profile?.is_active && profile.role === 'admin') return <PausedBusiness onSignOut={signOut} />;
  if (status === 'inactive')
    return (
      <FullScreenMessage
        title={t('public.auth.disabled')}
        message={profile && !profile.is_active ? t('public.auth.staffOff') : t('public.auth.businessOff')}
        onSignOut={signOut}
      />
    );
  if (status === 'error')
    return (
      <FullScreenMessage
        title={t('public.auth.loadFailed')}
        message={error ?? t('public.auth.tryAgain')}
        onSignOut={signOut}
      />
    );
  return <Outlet />;
}

function PausedBusiness({ onSignOut }: { onSignOut: () => void }) {
  const billing = useBillingOverview();
  const { t } = useT();
  if (billing.isLoading) return <FullScreenSpinner />;
  if (billing.data?.status !== 'suspended')
    return (
      <FullScreenMessage
        title={t('public.auth.disabled')}
        message={t('public.auth.businessOff')}
        onSignOut={onSignOut}
      />
    );
  return (
    <div className="min-h-full bg-slate-100 p-4">
      <div className="mx-auto max-w-2xl space-y-4">
        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <h1 className="text-xl font-bold text-slate-900">{t('public.auth.pausedTitle')}</h1>
          <p className="mt-2 text-slate-700">{t('public.auth.pausedText')}</p>
        </div>
        <BillingPanel />
        <button type="button" onClick={onSignOut} className="w-full text-center text-sm font-semibold text-slate-600 underline">
          {t('common.logout')}
        </button>
      </div>
    </div>
  );
}
