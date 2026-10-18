/** How businesses reach Hotzonex Cloud (landing page, Terms). Edit here; the pages follow. */
export const CONTACT = {
  /** Shown as written. */
  phone: '+211 924 904 216',
  /** Digits only, with country code, for wa.me links. */
  whatsapp: '211924904216',
  /** A public business email; null hides the email line. */
  email: 'info@hotzonex.net' as string | null,
  office: 'Gorom Head Office, Juba, South Sudan',
};

/** A WhatsApp chat with Hotzonex Cloud, with a first message already typed. */
export function whatsappLink(message: string): string {
  return `https://wa.me/${CONTACT.whatsapp}?text=${encodeURIComponent(message)}`;
}
