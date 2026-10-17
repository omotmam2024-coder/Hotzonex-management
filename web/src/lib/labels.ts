import type { VoucherStatus } from './types';

/** What staff see for each voucher status (Vouchers, Mark as sold). */
export const VOUCHER_STATUS: Record<VoucherStatus, { color: 'green' | 'red' | 'gray' | 'blue'; label: string }> = {
  unused: { color: 'gray', label: 'Unused' },
  sold: { color: 'blue', label: 'Sold' },
  active: { color: 'green', label: 'Active' },
  expired: { color: 'red', label: 'Expired' },
  disabled: { color: 'red', label: 'Disabled' },
};

/** What staff see for each mobile-money payment status. */
export const PAYMENT_STATUS: Record<'pending' | 'confirmed' | 'rejected' | 'expired', { color: 'green' | 'red' | 'gray' | 'blue'; label: string }> = {
  pending: { color: 'blue', label: 'To confirm' },
  confirmed: { color: 'green', label: 'Confirmed' },
  rejected: { color: 'red', label: 'Rejected' },
  expired: { color: 'gray', label: 'Expired' },
};

/** Fewer vouchers than this left for a plan on a router counts as "running low" (Sell, Dashboard). */
export const LOW_STOCK = 20;
