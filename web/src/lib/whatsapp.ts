/** "211924904216" → "+211 924 904 216" (same as supabase/functions/_shared/whatsapp.ts). */
export function formatWhatsAppNumber(n: string): string {
  const m = /^211([0-9]{3})([0-9]{3})([0-9]{3})$/.exec(n);
  return m ? `+211 ${m[1]} ${m[2]} ${m[3]}` : `+${n}`;
}

/** What the alerts function says about Hotzonex Cloud's WhatsApp sender. */
export interface WhatsAppStatus {
  installed: boolean;
  reachable?: boolean;
  connected: boolean;
  sender?: string | null;
  /** Platform admins only. */
  state?: 'starting' | 'qr' | 'connected' | 'reconnecting' | 'logged_out';
  since?: string;
  qr?: string | null;
  error?: string;
}
