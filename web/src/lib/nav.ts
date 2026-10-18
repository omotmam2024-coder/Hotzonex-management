import { translate } from '../i18n/translate';
import type { Role } from './types';

export type IconName =
  | 'dashboard'
  | 'sell'
  | 'vouchers'
  | 'plans'
  | 'routers'
  | 'sales'
  | 'reports'
  | 'active'
  | 'portal'
  | 'staff'
  | 'businesses'
  | 'alerts'
  | 'payments'
  | 'cash'
  | 'billing'
  | 'security'
  | 'settings'
  | 'expenses'
  | 'check';

export type NavGroup = 'Overview' | 'Selling' | 'Cards & WiFi' | 'Business';

export interface NavItem {
  path: string;
  label: string;
  icon: IconName;
  roles: readonly Role[];
  /** The menu section it is listed under. */
  group: NavGroup;
  /** Only for the people who run Hotzonex Cloud itself. */
  platformOnly?: boolean;
}

const ALL: readonly Role[] = ['admin', 'manager', 'seller'];
const ADMIN_MANAGER: readonly Role[] = ['admin', 'manager'];
const ADMIN: readonly Role[] = ['admin'];

/** Menu order and who may open each page. Route guards use the same list. */
export const NAV_ITEMS: readonly NavItem[] = [
  { path: '/dashboard', get label() { return translate('nav.dashboard'); }, icon: 'dashboard', roles: ADMIN_MANAGER, group: 'Overview' },
  { path: '/reports', get label() { return translate('nav.reports'); }, icon: 'reports', roles: ADMIN_MANAGER, group: 'Overview' },
  { path: '/expenses', get label() { return translate('nav.expenses'); }, icon: 'expenses', roles: ADMIN_MANAGER, group: 'Overview' },
  { path: '/alerts', get label() { return translate('nav.alerts'); }, icon: 'alerts', roles: ADMIN_MANAGER, group: 'Overview' },
  { path: '/sell', get label() { return translate('nav.sell'); }, icon: 'sell', roles: ALL, group: 'Selling' },
  { path: '/payments', get label() { return translate('nav.payments'); }, icon: 'payments', roles: ALL, group: 'Selling' },
  { path: '/sales', get label() { return translate('nav.sales'); }, icon: 'sales', roles: ALL, group: 'Selling' },
  { path: '/check', get label() { return translate('nav.check'); }, icon: 'check', roles: ALL, group: 'Selling' },
  { path: '/cash', get label() { return translate('nav.cash'); }, icon: 'cash', roles: ALL, group: 'Selling' },
  { path: '/vouchers', get label() { return translate('nav.vouchers'); }, icon: 'vouchers', roles: ADMIN_MANAGER, group: 'Cards & WiFi' },
  { path: '/plans', get label() { return translate('nav.plans'); }, icon: 'plans', roles: ADMIN, group: 'Cards & WiFi' },
  { path: '/routers', get label() { return translate('nav.routers'); }, icon: 'routers', roles: ADMIN, group: 'Cards & WiFi' },
  { path: '/active-users', get label() { return translate('nav.activeUsers'); }, icon: 'active', roles: ADMIN_MANAGER, group: 'Cards & WiFi' },
  { path: '/portal', get label() { return translate('nav.portal'); }, icon: 'portal', roles: ADMIN, group: 'Cards & WiFi' },
  { path: '/business', get label() { return translate('nav.business'); }, icon: 'settings', roles: ADMIN, group: 'Business' },
  { path: '/staff', get label() { return translate('nav.staff'); }, icon: 'staff', roles: ADMIN, group: 'Business' },
  { path: '/billing', get label() { return translate('nav.billing'); }, icon: 'billing', roles: ADMIN, group: 'Business' },
  { path: '/security', get label() { return translate('nav.security'); }, icon: 'security', roles: ALL, group: 'Business' },
  { path: '/businesses', get label() { return translate('nav.businesses'); }, icon: 'businesses', roles: ADMIN, group: 'Business', platformOnly: true },
];

/** The phone's bottom tab bar: the pages used most, by role (the menu has the rest). */
export function tabsForRole(role: Role): string[] {
  return role === 'seller' ? ['/sell', '/payments', '/sales', '/cash'] : ['/dashboard', '/sell', '/payments', '/vouchers'];
}

export function navForRole(role: Role, isPlatformAdmin = false): NavItem[] {
  return NAV_ITEMS.filter((item) => item.roles.includes(role) && (!item.platformOnly || isPlatformAdmin));
}

export function rolesFor(path: string): readonly Role[] {
  return NAV_ITEMS.find((item) => item.path === path)?.roles ?? ADMIN;
}

/** First page a user lands on after login. */
export function homePathFor(role: Role): string {
  return role === 'seller' ? '/sell' : '/dashboard';
}

/** Role names in the chosen language (database values stay admin / manager / seller). */
export const ROLE_LABELS: Record<Role, string> = {
  get admin() {
    return translate('role.admin');
  },
  get manager() {
    return translate('role.manager');
  },
  get seller() {
    return translate('role.seller');
  },
};

/** "Overview" etc. in the chosen language. */
export function groupLabel(group: NavGroup): string {
  return translate(({ Overview: 'nav.group.overview', Selling: 'nav.group.selling', 'Cards & WiFi': 'nav.group.cards', Business: 'nav.group.business' } as const)[group]);
}
