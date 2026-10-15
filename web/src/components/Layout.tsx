import { Suspense, useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { navForRole, ROLE_LABELS } from '../lib/nav';
import { FullScreenSpinner } from './FullScreen';
import { BillingBanner } from './BillingBanner';
import { SupportBar } from './SupportBar';
import { Icon } from './Icon';

function Brand() {
  return (
    <div className="flex items-center gap-2">
      <img src="/icon-72.png" alt="" className="h-9 w-9" />
      <span className="text-lg font-bold tracking-tight">Hotzonex Cloud</span>
    </div>
  );
}

export function Layout() {
  const { profile, siteName, business, isPlatformAdmin, signOut } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();

  // Close the mobile menu whenever the page changes.
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  if (!profile) return null;
  const items = navForRole(profile.role, isPlatformAdmin);
  const siteLabel = profile.site_id ? (siteName ?? 'Unknown site') : 'All sites';

  const sidebar = (
    <nav className="flex h-full flex-col bg-brand-900 text-white">
      <div className="flex h-16 items-center justify-between px-4">
        <Brand />
        <button
          type="button"
          className="rounded-lg p-2 hover:bg-white/10 lg:hidden"
          onClick={() => setMenuOpen(false)}
          aria-label="Close menu"
        >
          <Icon name="close" className="h-6 w-6" />
        </button>
      </div>
      <ul className="flex-1 space-y-1 overflow-y-auto px-2 py-2">
        {items.map((item) => (
          <li key={item.path}>
            <NavLink
              to={item.path}
              className={({ isActive }) =>
                `flex min-h-12 items-center gap-3 rounded-xl px-3 text-base font-medium transition ${
                  isActive ? 'bg-white text-brand-900' : 'text-white/85 hover:bg-white/10'
                }`
              }
            >
              <Icon name={item.icon} />
              {item.label}
            </NavLink>
          </li>
        ))}
      </ul>
      <div className="border-t border-white/10 p-3">
        <div className="px-1 pb-3 text-sm">
          {business && <div className="truncate text-xs font-semibold uppercase tracking-wide text-white/60">{business.name}</div>}
          <div className="truncate font-semibold">{profile.full_name}</div>
          <div className="text-white/70">
            {ROLE_LABELS[profile.role]} · {siteLabel}
          </div>
        </div>
        <button
          type="button"
          onClick={() => void signOut()}
          className="flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-white/85 hover:bg-white/10"
        >
          <Icon name="logout" />
          Log out
        </button>
        <button
          type="button"
          onClick={() => {
            if (window.confirm('Log out on all devices? Every phone and computer signed in with your account will need your password again.')) void signOut(true);
          }}
          className="mt-1 w-full rounded-xl px-3 py-2 text-left text-sm text-white/60 hover:bg-white/10 hover:text-white/85"
        >
          Log out on all devices
        </button>
      </div>
    </nav>
  );

  return (
    <div className="flex h-full print:block print:h-auto">
      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 lg:block print:!hidden">{sidebar}</aside>

      {/* Mobile drawer */}
      {menuOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMenuOpen(false)} aria-hidden="true" />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] shadow-xl">{sidebar}</aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col print:block">
        <header className="flex h-14 items-center gap-3 bg-brand-900 px-3 text-white lg:hidden print:hidden">
          <button
            type="button"
            className="rounded-lg p-2 hover:bg-white/10"
            onClick={() => setMenuOpen(true)}
            aria-label="Open menu"
          >
            <Icon name="menu" className="h-6 w-6" />
          </button>
          <Brand />
        </header>
        <main className="min-w-0 flex-1 overflow-y-auto p-4 lg:p-8 print:overflow-visible print:p-0">
          <SupportBar />
          <BillingBanner />
          <Suspense fallback={<FullScreenSpinner />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
}
