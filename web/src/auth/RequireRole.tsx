import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from './AuthProvider';
import { homePathFor } from '../lib/nav';
import type { Role } from '../lib/types';

/** Sends staff to their home page when they open a page their role cannot use. */
export function RequireRole({ roles }: { roles: readonly Role[] }) {
  const { profile } = useAuth();
  if (!profile) return null;
  if (!roles.includes(profile.role)) return <Navigate to={homePathFor(profile.role)} replace />;
  return <Outlet />;
}
