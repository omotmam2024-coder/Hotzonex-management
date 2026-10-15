import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './AuthProvider';
import { BillingPanel, useBillingOverview } from '../components/BillingPanel';
import { FullScreenMessage, FullScreenSpinner } from '../components/FullScreen';

/** Lets only signed-in, active staff with a profile through. */
export function RequireAuth() {
  const { status, profile, error, signOut } = useAuth();
  const location = useLocation();

  if (status === 'loading') return <FullScreenSpinner />;
  if (status === 'signed_out' || status === 'mfa') return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (status === 'no_profile')
    return (
      <FullScreenMessage
        title="Account not set up"
        message="Your login works, but no staff profile is linked to it. Ask an admin to add you on the Staff page."
        onSignOut={signOut}
      />
    );
  // An admin of a business paused for an unpaid invoice can still see it and send the payment.
  if (status === 'inactive' && profile?.is_active && profile.role === 'admin') return <PausedBusiness onSignOut={signOut} />;
  if (status === 'inactive')
    return (
      <FullScreenMessage
        title="Account disabled"
        message={
          profile && !profile.is_active
            ? 'Your staff account has been switched off. Ask an admin if you need access.'
            : 'This business is switched off on Hotzonex Cloud. Contact Hotzonex Cloud to switch it back on.'
        }
        onSignOut={signOut}
      />
    );
  if (status === 'error')
    return (
      <FullScreenMessage
        title="Could not load your account"
        message={error ?? 'Please try again.'}
        onSignOut={signOut}
      />
    );
  return <Outlet />;
}

function PausedBusiness({ onSignOut }: { onSignOut: () => void }) {
  const billing = useBillingOverview();
  if (billing.isLoading) return <FullScreenSpinner />;
  if (billing.data?.status !== 'suspended')
    return (
      <FullScreenMessage
        title="Account disabled"
        message="This business is switched off on Hotzonex Cloud. Contact Hotzonex Cloud to switch it back on."
        onSignOut={onSignOut}
      />
    );
  return (
    <div className="min-h-full bg-slate-100 p-4">
      <div className="mx-auto max-w-2xl space-y-4">
        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <h1 className="text-xl font-bold text-slate-900">Hotzonex Cloud is paused</h1>
          <p className="mt-2 text-slate-700">
            An invoice is unpaid. Your WiFi and cards keep working, but the app is closed until it is paid. Pay it, then type the transaction ID
            below: the app opens again as soon as Hotzonex Cloud confirms it.
          </p>
        </div>
        <BillingPanel />
        <button type="button" onClick={onSignOut} className="w-full text-center text-sm font-semibold text-slate-600 underline">
          Log out
        </button>
      </div>
    </div>
  );
}
