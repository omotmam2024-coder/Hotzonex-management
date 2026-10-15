// What an alert says on Telegram, and which alerts a business wants there.

export interface AlertRow {
  kind: string;
  title: string;
  body: string;
}

export interface AlertSettings {
  telegram_chat_id: string | null;
  notify_offline: boolean;
  notify_push: boolean;
  notify_low_stock: boolean;
  notify_payments: boolean;
}

/** Link codes made by the "link" action (12 letters and digits, no look-alikes). */
export const LINK_CODE_RE = /^[a-hjkmnp-z2-9]{12}$/;

const ICONS: Record<string, string> = {
  router_offline: '🔴',
  router_online: '🟢',
  push_failed: '⛔',
  push_warning: '⚠️',
  low_stock: '📉',
  payment_request: '💰',
  billing: '🧾',
  test: '✅',
};

/** The switch in the business's alert settings that covers this kind (billing and tests always go). */
export function wantsAlert(s: AlertSettings, kind: string): boolean {
  switch (kind) {
    case 'router_offline':
    case 'router_online':
      return s.notify_offline;
    case 'push_failed':
    case 'push_warning':
      return s.notify_push;
    case 'low_stock':
      return s.notify_low_stock;
    case 'payment_request':
      return s.notify_payments;
    default:
      return true;
  }
}

/** Plain text (no Markdown, so names with * or _ never break it). */
export function alertMessage(a: AlertRow, business: string): string {
  const head = `${ICONS[a.kind] ?? '•'} ${a.title}`;
  const lines = [head];
  if (a.body.trim()) lines.push(a.body.trim());
  if (business) lines.push(`— ${business}`);
  return lines.join('\n').slice(0, 4000);
}
