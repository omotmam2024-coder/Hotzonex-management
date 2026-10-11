/** Who the printed cards and receipts belong to: the signed-in business. */
export interface PrintBrand {
  name: string;
  logoUrl: string | null;
}

export const DEFAULT_BRAND: PrintBrand = { name: 'Hotzonex WiFi', logoUrl: null };

/** The printing brand of the signed-in business. */
export function brandOf(business: { name: string; logo_url: string | null } | null): PrintBrand {
  return business ? { name: business.name, logoUrl: business.logo_url } : DEFAULT_BRAND;
}
