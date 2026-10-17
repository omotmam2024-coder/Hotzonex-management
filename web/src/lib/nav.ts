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
  | 'expenses';

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
  { path: '/dashboard', label: 'Dashboard', icon: 'dashboard', roles: ADMIN_MANAGER, group: 'Overview' },
  { path: '/reports', label: 'Reports', icon: 'reports', roles: ADMIN_MANAGER, group: 'Overview' },
  { path: '/expenses', label: 'Expenses & profit', icon: 'expenses', roles: ADMIN_MANAGER, group: 'Overview' },
  { path: '/alerts', label: 'Alerts', icon: 'alerts', roles: ADMIN_MANAGER, group: 'Overview' },
  { path: '/sell', label: 'Sell', icon: 'sell', roles: ALL, group: 'Selling' },
  { path: '/payments', label: 'Payments', icon: 'payments', roles: ALL, group: 'Selling' },
  { path: '/sales', label: 'Sales', icon: 'sales', roles: ALL, group: 'Selling' },
  { path: '/cash', label: 'Cash-up', icon: 'cash', roles: ALL, group: 'Selling' },
  { path: '/vouchers', label: 'Vouchers', icon: 'vouchers', roles: ADMIN_MANAGER, group: 'Cards & WiFi' },
  { path: '/plans', label: 'Plans', icon: 'plans', roles: ADMIN, group: 'Cards & WiFi' },
  { path: '/routers', label: 'Routers', icon: 'routers', roles: ADMIN, group: 'Cards & WiFi' },
  { path: '/active-users', label: 'Active Users', icon: 'active', roles: ADMIN_MANAGER, group: 'Cards & WiFi' },
  { path: '/portal', label: 'Login Portal', icon: 'portal', roles: ADMIN, group: 'Cards & WiFi' },
  { path: '/business', label: 'Business settings', icon: 'settings', roles: ADMIN, group: 'Business' },
  { path: '/staff', label: 'Staff', icon: 'staff', roles: ADMIN, group: 'Business' },
  { path: '/billing', label: 'Billing', icon: 'billing', roles: ADMIN, group: 'Business' },
  { path: '/security', label: 'Security', icon: 'security', roles: ALL, group: 'Business' },
  { path: '/businesses', label: 'Businesses', icon: 'businesses', roles: ADMIN, group: 'Business', platformOnly: true },
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

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Owner',
  manager: 'Manager',
  seller: 'Cashier / agent',
};
