// Refer a friend: the customer-facing codes made on the Buy page (see migration 20261031190000_referrals.sql).

/** A referral code can be used by this many friends. */
export const REFERRAL_MAX_USES = 5;

/** "R-" and 8 random hex digits, upper case (cryptographically random: the code is the discount). */
export function newReferralCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  return `R-${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}
