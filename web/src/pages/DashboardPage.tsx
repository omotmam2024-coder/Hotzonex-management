import { useAuth } from '../auth/AuthProvider';
import { PageHeader } from '../components/PageHeader';
import { ROLE_LABELS } from '../lib/nav';

export function DashboardPage() {
  const { profile, siteName } = useAuth();
  if (!profile) return null;
  const site = profile.site_id ? (siteName ?? 'Unknown site') : 'All sites';
  const today = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Juba',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date());

  return (
    <div>
      <PageHeader title={`Welcome, ${profile.full_name}`} subtitle={today} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <div className="text-sm text-slate-500">Role</div>
          <div className="mt-1 text-2xl font-bold">{ROLE_LABELS[profile.role]}</div>
        </div>
        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <div className="text-sm text-slate-500">Site</div>
          <div className="mt-1 text-2xl font-bold">{site}</div>
        </div>
      </div>
      <p className="mt-6 max-w-2xl text-slate-600">
        Revenue cards, the 14-day revenue chart and stock per plan are added to this page in Phase 8.
      </p>
    </div>
  );
}
