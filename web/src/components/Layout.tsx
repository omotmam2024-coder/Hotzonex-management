import { Suspense, useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { groupLabel, NAV_ITEMS, navForRole, ROLE_LABELS, tabsForRole, type NavGroup, type NavItem } from '../lib/nav';
import { LANGUAGES, useT } from '../i18n';
import { FullScreenSpinner } from './FullScreen';
import { ErrorBoundary } from './ErrorBoundary';
import { BillingBanner } from './BillingBanner';
import { SupportBar } from './SupportBar';
import { Icon } from './Icon';
import { reloadForUpdate, updateReady, watchForUpdates } from '../lib/appUpdate';
import { CONTACT, whatsappLink } from '../lib/contact';
import { getThemePref, setThemePref, type ThemePref } from '../lib/theme';

const GROUPS: NavGroup[] = ['Overview', 'Selling', 'Cards & WiFi', 'Business'];

function Brand() {
  return (
    <Link to="/" className="flex items-center gap-2.5">
      <img src="/icon-72.png" alt="" className="h-8 w-8" />
      <span className="text-[17px] font-bold tracking-tight">Hotzonex Cloud</span>
    </Link>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '')).toUpperCase() || '?';
}

function MenuLink({ item }: { item: NavItem }) {
  return (
    <NavLink
      to={item.path}
      className={({ isActive }) =>
        `group relative flex h-10 items-center gap-3 rounded-lg px-3 text-[15px] font-medium transition-colors ${
          isActive ? 'bg-white/[0.12] text-white' : 'text-white/70 hover:bg-white/[0.06] hover:text-white'
        }`
      }
    >
      {({ isActive }) => (
        <>
          {isActive && <span className="absolute inset-y-2 start-0 w-1 rounded-e-full bg-brand-300" aria-hidden="true" />}
          <Icon name={item.icon} className={`h-5 w-5 shrink-0 ${isActive ? 'text-brand-200' : 'text-white/50 group-hover:text-white/80'}`} />
          {item.label}
        </>
      )}
    </NavLink>
  );
}

const THEMES = [
  { key: 'light', label: 'theme.light', icon: 'sun' },
  { key: 'dark', label: 'theme.dark', icon: 'moon' },
  { key: 'system', label: 'theme.auto', icon: 'auto' },
] as const satisfies readonly { key: ThemePref; label: string; icon: 'sun' | 'moon' | 'auto' }[];

/**
 * The bottom of the menu: who is logged in. Tapping it opens a small menu with the language,
 * Light / Dark / Auto (saved on this device), help from Hotzonex Cloud and Log out.
 */
function AccountMenu({ name, detail, business, onLogout }: { name: string; detail: string; business: string | null; onLogout: () => void }) {
  const { t, lang, setLang } = useT();
  const [open, setOpen] = useState(false);
  const [pref, setPref] = useState<ThemePref>(getThemePref);
  const box = useRef<HTMLDivElement>(null);
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname]);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent | TouchEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', away);
    document.addEventListener('touchstart', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('touchstart', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const chip = (on: boolean) =>
    `inline-flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-lg px-2 text-xs font-semibold transition ${on ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'}`;
  const rowBase = 'flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-sm font-medium';
  const row = `${rowBase} text-slate-700 hover:bg-slate-100`;

  return (
    <div ref={box} className="relative">
      {open && (
        <div role="menu" className="absolute inset-x-0 bottom-full z-50 mb-2 space-y-3 rounded-2xl bg-white p-3 text-slate-900 shadow-2xl ring-1 ring-slate-200">
          <div>
            <p className="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{t('lang.label')}</p>
            <div className="flex gap-1 rounded-xl bg-slate-50 p-1 ring-1 ring-slate-200" role="radiogroup" aria-label={t('lang.label')}>
              {LANGUAGES.map((l) => (
                <button key={l.key} type="button" role="radio" lang={l.key} aria-checked={lang === l.key} onClick={() => setLang(l.key)} className={chip(lang === l.key)}>
                  {l.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{t('theme.label')}</p>
            <div className="flex gap-1 rounded-xl bg-slate-50 p-1 ring-1 ring-slate-200" role="radiogroup" aria-label={t('theme.label')}>
              {THEMES.map((theme) => (
                <button
                  key={theme.key}
                  type="button"
                  role="radio"
                  aria-checked={pref === theme.key}
                  onClick={() => {
                    setThemePref(theme.key);
                    setPref(theme.key);
                  }}
                  className={chip(pref === theme.key)}
                >
                  <Icon name={theme.icon} className="h-3.5 w-3.5" />
                  {t(theme.label)}
                </button>
              ))}
            </div>
          </div>
          <div className="border-t border-slate-100 pt-2">
            <p className="mb-1 px-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{t('common.help')}</p>
            <a href={whatsappLink('Hotzonex Cloud')} target="_blank" rel="noopener noreferrer" className={row}>
              <Icon name="whatsapp" className="h-5 w-5 shrink-0 text-[#25D366]" />
              <span className="min-w-0 flex-1 truncate" dir="ltr">
                {CONTACT.phone}
              </span>
            </a>
            {CONTACT.email && (
              <a href={`mailto:${CONTACT.email}`} className={row}>
                <Icon name="mail" className="h-5 w-5 shrink-0 text-slate-500" />
                <span className="min-w-0 flex-1 truncate" dir="ltr">
                  {CONTACT.email}
                </span>
              </a>
            )}
          </div>
          <div className="border-t border-slate-100 pt-2">
            <button type="button" onClick={onLogout} className={`${rowBase} text-red-700 hover:bg-red-50`}>
              <Icon name="logout" className="h-5 w-5 shrink-0" />
              {t('common.logout')}
            </button>
          </div>
        </div>
      )}
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`flex w-full items-center gap-3 rounded-xl p-2.5 text-start transition hover:bg-white/10 ${open ? 'bg-white/10' : ''}`}
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-500 text-sm font-bold">{initials(name)}</span>
        <span className="min-w-0 flex-1 text-sm leading-tight">
          <span className="block truncate font-semibold">{name}</span>
          <span className="block truncate text-xs text-white/60">{detail}</span>
          {business && <span className="block truncate text-xs text-white/50">{business}</span>}
        </span>
        <Icon name="chevron" className={`h-5 w-5 shrink-0 text-white/60 transition ${open ? '' : 'rotate-180'}`} />
      </button>
    </div>
  );
}

export function Layout() {
  const { t } = useT();
  const { profile, siteName, business, isPlatformAdmin, signOut } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();

  // Close the phone menu whenever the page changes.
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  // A newer version is live: the page just chosen opens in it (a full load of the same address).
  useEffect(() => watchForUpdates(), []);
  const shownPath = useRef(location.pathname);
  useEffect(() => {
    if (location.pathname !== shownPath.current && updateReady()) reloadForUpdate();
    shownPath.current = location.pathname;
  }, [location.pathname]);

  if (!profile) return null;
  const items = navForRole(profile.role, isPlatformAdmin);
  const tabs = tabsForRole(profile.role)
    .map((path) => items.find((i) => i.path === path))
    .filter((i): i is NavItem => Boolean(i));
  const siteLabel = profile.site_id ? (siteName ?? t('common.unknownSite')) : t('common.allSites');
  const current = NAV_ITEMS.find((i) => location.pathname === i.path || location.pathname.startsWith(`${i.path}/`));

  const sidebar = (
    <nav className="flex h-full flex-col bg-gradient-to-b from-brand-900 to-brand-950 text-white">
      <div className="flex h-16 shrink-0 items-center justify-between px-4">
        <Brand />
        <button type="button" className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-white/70 hover:bg-white/10 lg:hidden" onClick={() => setMenuOpen(false)} aria-label={t('nav.closeMenu')}>
          <Icon name="close" className="h-6 w-6" />
        </button>
      </div>
      <div className="flex-1 space-y-5 overflow-y-auto px-3 pb-4 pt-1">
        {GROUPS.map((group) => {
          const inGroup = items.filter((i) => i.group === group);
          if (!inGroup.length) return null;
          return (
            <div key={group}>
              <p className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-wider text-white/60">{groupLabel(group)}</p>
              <ul className="space-y-0.5">
                {inGroup.map((item) => (
                  <li key={item.path}>
                    <MenuLink item={item} />
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
      <div className="shrink-0 border-t border-white/10 p-2">
        <AccountMenu name={profile.full_name} detail={`${ROLE_LABELS[profile.role]} · ${siteLabel}`} business={business?.name ?? null} onLogout={() => void signOut()} />
      </div>
    </nav>
  );

  return (
    <div className="flex h-full print:block print:h-auto">
      {/* Computer: the menu stays on the left. */}
      <aside className="hidden w-64 shrink-0 lg:block print:!hidden">{sidebar}</aside>

      {/* Phone: the full menu slides in. */}
      {menuOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-950/50 backdrop-blur-[1px]" onClick={() => setMenuOpen(false)} aria-hidden="true" />
          <aside className="absolute inset-y-0 start-0 w-72 max-w-[85vw] shadow-2xl">{sidebar}</aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col print:block">
        <header className="flex h-14 shrink-0 items-center gap-2 bg-brand-900 px-2 text-white shadow-sm lg:hidden print:hidden">
          <button type="button" className="inline-flex h-11 w-11 items-center justify-center rounded-lg hover:bg-white/10" onClick={() => setMenuOpen(true)} aria-label={t('nav.openMenu')}>
            <Icon name="menu" className="h-6 w-6" />
          </button>
          <Brand />
          {business && <span className="ms-auto max-w-[40%] truncate pe-2 text-xs font-medium text-white/60">{business.name}</span>}
        </header>
        <main className="min-w-0 flex-1 overflow-y-auto px-4 pb-24 pt-4 sm:px-6 lg:px-10 lg:pb-10 lg:pt-8 print:overflow-visible print:p-0">
          <div className="mx-auto w-full max-w-6xl">
            <SupportBar />
            <BillingBanner />
            <ErrorBoundary resetKey={location.pathname}>
              <Suspense fallback={<FullScreenSpinner />}>
                <Outlet />
              </Suspense>
            </ErrorBoundary>
          </div>
        </main>

        {/* Phone: the pages used most, one tap away. */}
        <nav
          className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 backdrop-blur lg:hidden print:hidden"
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
          aria-label={t('nav.mainPages')}
        >
          <ul className="mx-auto grid max-w-md grid-cols-5">
            {tabs.map((t) => (
              <li key={t.path}>
                <NavLink
                  to={t.path}
                  className={({ isActive }) =>
                    `flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-semibold ${isActive ? 'text-brand-600' : 'text-slate-500'}`
                  }
                >
                  {({ isActive }) => (
                    <>
                      <span className={`rounded-full px-4 py-1 ${isActive ? 'bg-brand-50' : ''}`}>
                        <Icon name={t.icon} className="h-5 w-5" />
                      </span>
                      {t.label}
                    </>
                  )}
                </NavLink>
              </li>
            ))}
            <li>
              <button
                type="button"
                onClick={() => setMenuOpen(true)}
                className={`flex h-16 w-full flex-col items-center justify-center gap-1 text-[11px] font-semibold ${
                  current && !tabs.some((t) => t.path === current.path) ? 'text-brand-600' : 'text-slate-500'
                }`}
              >
                <span className="rounded-full px-4 py-1">
                  <Icon name="menu" className="h-5 w-5" />
                </span>
                {t('nav.more')}
              </button>
            </li>
          </ul>
        </nav>
      </div>
    </div>
  );
}
