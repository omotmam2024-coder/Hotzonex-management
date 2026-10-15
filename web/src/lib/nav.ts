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
  | 'payments';

export interface NavItem {
  path: string;
  label: string;
  icon: IconName;
  roles: readonly Role[];
  /** Only for the people who run Hotzonex Cloud itself. */
  platformOnly?: boolean;
}

const ALL: readonly Role[] = ['admin', 'manager', 'seller'];
const ADMIN_MANAGER: readonly Role[] = ['admin', 'manager'];
const ADMIN: readonly Role[] = ['admin'];

/** Sidebar order and who may open each page. Route guards use the same list. */
export const NAV_ITEMS: readonly NavItem[] = [
  { path: '/dashboard', label: 'Dashboard', icon: 'dashboard', roles: ADMIN_MANAGER },
  { path: '/sell', label: 'Sell', icon: 'sell', roles: ALL },
  { path: '/vouchers', label: 'Vouchers', icon: 'vouchers', roles: ADMIN_MANAGER },
  { path: '/plans', label: 'Plans', icon: 'plans', roles: ADMIN },
  { path: '/routers', label: 'Routers', icon: 'routers', roles: ADMIN },
  { path: '/portal', label: 'Login Portal', icon: 'portal', roles: ADMIN },
  { path: '/payments', label: 'Payments', icon: 'payments', roles: ALL },
  { path: '/sales', label: 'Sales', icon: 'sales', roles: ALL },
  { path: '/reports', label: 'Reports', icon: 'reports', roles: ADMIN_MANAGER },
  { path: '/active-users', label: 'Active Users', icon: 'active', roles: ADMIN_MANAGER },
  { path: '/alerts', label: 'Alerts', icon: 'alerts', roles: ADMIN_MANAGER },
  { path: '/staff', label: 'Staff', icon: 'staff', roles: ADMIN },
  { path: '/businesses', label: 'Businesses', icon: 'businesses', roles: ADMIN, platformOnly: true },
];

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
  admin: 'Admin',
  manager: 'Manager',
  seller: 'Seller',
};
