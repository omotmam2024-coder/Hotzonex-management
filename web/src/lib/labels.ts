import { translate } from '../i18n/translate';
import type { VoucherStatus } from './types';

/** What staff see for each voucher status (Vouchers, Mark as sold). */
export const VOUCHER_STATUS: Record<VoucherStatus, { color: 'green' | 'red' | 'gray' | 'blue'; label: string }> = {
  unused: { color: 'gray', get label() { return translate('voucher.unused'); } },
  sold: { color: 'blue', get label() { return translate('voucher.sold'); } },
  active: { color: 'green', get label() { return translate('voucher.active'); } },
  expired: { color: 'red', get label() { return translate('voucher.expired'); } },
  disabled: { color: 'red', get label() { return translate('voucher.disabled'); } },
};

/** What staff see for each mobile-money payment status. */
export const PAYMENT_STATUS: Record<'pending' | 'confirmed' | 'rejected' | 'expired', { color: 'green' | 'red' | 'gray' | 'blue'; label: string }> = {
  pending: { color: 'blue', get label() { return translate('payment.pending'); } },
  confirmed: { color: 'green', get label() { return translate('payment.confirmed'); } },
  rejected: { color: 'red', get label() { return translate('payment.rejected'); } },
  expired: { color: 'gray', get label() { return translate('payment.expired'); } },
};

/** Fewer vouchers than this left for a plan on a router counts as "running low" (Sell, Dashboard). */
export const LOW_STOCK = 20;
