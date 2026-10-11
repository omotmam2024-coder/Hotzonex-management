import type { IconName } from '../lib/nav';

const PATHS: Record<IconName | 'menu' | 'close' | 'logout', string> = {
  dashboard: 'M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z',
  sell: 'M7 4V2h10v2h3a1 1 0 0 1 1 1v15a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a1 1 0 0 1 1-1h3zm0 2H5v14h14V6h-2v2H7V6zm2-2v2h6V4H9zm-1 7h8v2H8v-2zm0 4h5v2H8v-2z',
  vouchers: 'M2 6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v3a3 3 0 0 0 0 6v3a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-3a3 3 0 0 0 0-6V6zm7 1v2h2V7H9zm0 4v2h2v-2H9zm0 4v2h2v-2H9z',
  plans: 'M4 4h16v4H4V4zm0 6h10v4H4v-4zm0 6h13v4H4v-4z',
  routers: 'M4 14h16a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2zm2 3v2h2v-2H6zm4 0v2h2v-2h-2zM11 13V9h2v4h-2zM7.05 7.05a7 7 0 0 1 9.9 0l-1.42 1.42a5 5 0 0 0-7.06 0L7.05 7.05zM4.22 4.22a11 11 0 0 1 15.56 0l-1.41 1.41a9 9 0 0 0-12.74 0L4.22 4.22z',
  sales: 'M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zm1 4h-2v1.1A3 3 0 0 0 11.5 13h1a1 1 0 0 1 0 2H9v2h2v1h2v-1.1A3 3 0 0 0 12.5 11h-1a1 1 0 0 1 0-2H15V7h-2V6z',
  reports: 'M4 20V10h3v10H4zm6.5 0V4h3v16h-3zM17 20v-7h3v7h-3z',
  active: 'M12 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8zm0 10c4.42 0 8 1.79 8 4v2H4v-2c0-2.21 3.58-4 8-4z',
  portal: 'M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm0 3v12h10V5H7zm5 13.5a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5zM9 8h6v2H9V8zm0 4h6v2H9v-2z',
  staff: 'M9 4a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7zm7.5 1a3 3 0 1 1 0 6 3 3 0 0 1 0-6zM9 13c3.87 0 7 1.57 7 3.5V19H2v-2.5C2 14.57 5.13 13 9 13zm8.5.2c2.6.37 4.5 1.6 4.5 3.3V19h-4v-2.5c0-1.27-.18-2.36-.5-3.3z',
  businesses: 'M3 21V7l6-4 6 4v2h6v12H3zm2-2h4v-3h2v3h2V8l-4-2.6L5 8v11zm10 0h4v-8h-4v8zM7 9h2v2H7V9zm0 4h2v2H7v-2zm4-4h2v2h-2V9zm0 4h2v2h-2v-2z',
  menu: 'M3 6h18v2H3V6zm0 5h18v2H3v-2zm0 5h18v2H3v-2z',
  close: 'M6.4 5 12 10.6 17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6 10.6 12 5 6.4 6.4 5z',
  logout: 'M10 3h9a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-9v-2h9V5h-9V3zm-.5 4.5L11 9l-2 2h8v2H9l2 2-1.5 1.5L5 12l4.5-4.5z',
};

export function Icon({ name, className = 'h-5 w-5' }: { name: keyof typeof PATHS; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d={PATHS[name]} />
    </svg>
  );
}
