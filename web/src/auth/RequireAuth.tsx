import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './AuthProvider';
import { FullScreenMessage, FullScreenSpinner } from '../components/FullScreen';

/** Lets only signed-in, active staff with a profile through. */
export function RequireAuth() {
  const { status, error, signOut } = useAuth();
  const location = useLocation();

  if (status === 'loading') return <FullScreenSpinner />;
  if (status === 'signed_out') return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (status === 'no_profile')
    return (
      <FullScreenMessage
        title="Account not set up"
        message="Your login works, but no staff profile is linked to it. Ask an admin to add you on the Staff page."
        onSignOut={signOut}
      />
    );
  if (status === 'inactive')
    return (
      <FullScreenMessage
        title="Account disabled"
        message="Your staff account has been switched off. Ask an admin if you need access."
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
