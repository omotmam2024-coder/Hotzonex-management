// Emails Hotzonex Cloud sends itself (not Supabase Auth's own emails), through Resend's API.
// The Edge Function secret RESEND_API_KEY must be set; EMAIL_FROM is optional (a verified sender
// on Resend). Pure functions with the HTTP call passed in, so they run in tests under Node too.

export type EmailLang = 'en' | 'ar' | 'sw';

export const DEFAULT_FROM = 'Hotzonex Cloud <noreply@mail.hotzonex.net>';

export interface Email {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/** HTML-escapes text placed in an email. */
export function esc(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/**
 * Sends one email with Resend. Returns null when sent, or a short reason when not (no API key,
 * Resend refused it, or it could not be reached). Never throws: an email is never worth failing
 * the action it reports on. idempotencyKey stops a retried request from sending twice.
 */
export async function sendEmail(
  email: Email,
  opts: { apiKey: string | undefined; from?: string; idempotencyKey?: string; http?: typeof fetch },
): Promise<string | null> {
  if (!opts.apiKey) return 'Email is not set up (RESEND_API_KEY is missing).';
  try {
    const res = await (opts.http ?? fetch)('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        'Content-Type': 'application/json',
        ...(opts.idempotencyKey ? { 'Idempotency-Key': opts.idempotencyKey.slice(0, 256) } : {}),
      },
      body: JSON.stringify({ from: opts.from || DEFAULT_FROM, to: [email.to], subject: email.subject, html: email.html, text: email.text }),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) return null;
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    return `Resend refused the email (HTTP ${res.status}${body?.message ? `: ${body.message.slice(0, 120)}` : ''}).`;
  } catch (err) {
    return `Resend could not be reached (${err instanceof Error ? err.message.slice(0, 80) : 'error'}).`;
  }
}

export interface WelcomeInput {
  lang: EmailLang;
  to: string;
  name: string;
  business: string;
  role: 'admin' | 'manager' | 'seller';
  loginUrl: string;
  /** A one-time link to choose their own password; null when it could not be made. */
  passwordUrl: string | null;
}

const ROLE: Record<EmailLang, Record<WelcomeInput['role'], string>> = {
  en: { admin: 'Owner', manager: 'Manager', seller: 'Cashier / agent' },
  ar: { admin: 'المالك', manager: 'المدير', seller: 'كاشير / وكيل' },
  sw: { admin: 'Mmiliki', manager: 'Meneja', seller: 'Keshia / wakala' },
};

const TEXT: Record<
  EmailLang,
  {
    subject: string;
    hello: string;
    added: string;
    role: string;
    login: string;
    email: string;
    password: string;
    choose: string;
    chooseNote: string;
    button: string;
    loginButton: string;
    phone: string;
    notYou: string;
    footer: string;
  }
> = {
  en: {
    subject: 'Welcome to {business} on Hotzonex Cloud',
    hello: 'Hello {name},',
    added: '{business} has added you to its team on Hotzonex Cloud, the app for selling WiFi cards.',
    role: 'Your role',
    login: 'Log in at',
    email: 'Your login email',
    password: 'Your password: the one the owner set for you (ask them for it), or choose your own below.',
    choose: 'Choose your own password',
    chooseNote: 'This link works once and expires in 24 hours.',
    button: 'Choose my password',
    loginButton: 'Open Hotzonex Cloud',
    phone: 'It works on any phone: add it to your home screen from the browser menu.',
    notYou: 'Not expecting this? You can ignore this email.',
    footer: 'Hotzonex Cloud, Juba, South Sudan. Questions? WhatsApp +211 924 904 216.',
  },
  ar: {
    subject: 'مرحباً بك في {business} على Hotzonex Cloud',
    hello: 'مرحباً {name}،',
    added: 'أضافك {business} إلى فريقه على Hotzonex Cloud، تطبيق بيع بطاقات الواي فاي.',
    role: 'دورك',
    login: 'سجّل الدخول على',
    email: 'بريد الدخول الخاص بك',
    password: 'كلمة المرور: التي وضعها لك المالك (اسأله عنها)، أو اختر كلمتك بنفسك أدناه.',
    choose: 'اختر كلمة المرور بنفسك',
    chooseNote: 'يعمل هذا الرابط مرة واحدة وتنتهي صلاحيته خلال 24 ساعة.',
    button: 'اختر كلمة المرور',
    loginButton: 'افتح Hotzonex Cloud',
    phone: 'يعمل على أي هاتف: أضفه إلى الشاشة الرئيسية من قائمة المتصفح.',
    notYou: 'لم تكن تتوقع هذه الرسالة؟ يمكنك تجاهلها.',
    footer: 'Hotzonex Cloud، جوبا، جنوب السودان. أسئلة؟ واتساب +211 924 904 216.',
  },
  sw: {
    subject: 'Karibu {business} kwenye Hotzonex Cloud',
    hello: 'Habari {name},',
    added: '{business} imekuongeza kwenye timu yake kwenye Hotzonex Cloud, programu ya kuuza kadi za WiFi.',
    role: 'Nafasi yako',
    login: 'Ingia kwenye',
    email: 'Barua pepe yako ya kuingia',
    password: 'Nenosiri lako: lile mmiliki alilokuwekea (muulize), au chagua lako mwenyewe hapa chini.',
    choose: 'Chagua nenosiri lako mwenyewe',
    chooseNote: 'Kiungo hiki kinafanya kazi mara moja na kinaisha baada ya saa 24.',
    button: 'Chagua nenosiri langu',
    loginButton: 'Fungua Hotzonex Cloud',
    phone: 'Inafanya kazi kwenye simu yoyote: iongeze kwenye skrini ya mwanzo kutoka menyu ya kivinjari.',
    notYou: 'Hukutarajia hii? Unaweza kupuuza barua pepe hii.',
    footer: 'Hotzonex Cloud, Juba, Sudan Kusini. Maswali? WhatsApp +211 924 904 216.',
  },
};

function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => vars[k] ?? m);
}

// Hotzonex Cloud's colours (the app's brand blue, web/tailwind.config.js), the same look as the
// sign-up and password emails (supabase/templates): a blue header with the logo, a white card,
// a blue button and the contact footer. Table layout and inline styles only, so it shows the same
// in Gmail, Outlook and phone mail apps.
const BRAND = '#15479c';
const PAGE = '#eef6ff';
const LOGO = 'https://hotzonex.net/icon-192.png';
const FONT = 'font-family:Arial,Helvetica,sans-serif;';

/** The welcome email a new staff member gets: who added them, their role, where to log in. */
export function staffWelcomeEmail(w: WelcomeInput): Email {
  const t = TEXT[w.lang];
  const role = ROLE[w.lang][w.role];
  const dir = w.lang === 'ar' ? 'rtl' : 'ltr';
  const align = dir === 'rtl' ? 'right' : 'left';
  const vars = { business: w.business, name: w.name };
  const subject = fill(t.subject, vars);
  const card = (inner: string, top: number, bottom: number, last = false) =>
    `<tr><td bgcolor="#ffffff" align="${align}" style="background-color:#ffffff;${last ? 'border-radius:0 0 12px 12px;' : ''}padding-top:${top}px;padding-bottom:${bottom}px;padding-left:28px;padding-right:28px;">${inner}</td></tr>`;
  const para = (text: string, size = 15, color = '#1f2937', bottom = 16) =>
    `<p style="margin-top:0;margin-bottom:${bottom}px;${FONT}font-size:${size}px;line-height:${size + 8}px;color:${color};">${text}</p>`;
  const button = (href: string, label: string) =>
    `<table cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="${BRAND}" style="background-color:${BRAND};border-radius:10px;padding-top:12px;padding-bottom:12px;padding-left:22px;padding-right:22px;"><a href="${esc(href)}" style="${FONT}font-size:15px;line-height:18px;color:#ffffff;font-weight:bold;text-decoration:none;">${esc(label)}</a></td></tr></table>`;
  const row = (label: string, value: string, ltr = true) =>
    `<tr><td style="padding-top:6px;padding-bottom:6px;${FONT}font-size:14px;line-height:20px;color:#5b6670;">${esc(label)}</td><td${ltr ? ' dir="ltr"' : ''} style="padding-top:6px;padding-bottom:6px;padding-left:12px;padding-right:12px;${FONT}font-size:14px;line-height:20px;color:#111827;font-weight:bold;">${value}</td></tr>`;

  const html = `<!DOCTYPE html>
<html lang="${w.lang}" dir="${dir}">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background-color:${PAGE};">
<table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${PAGE}" dir="${dir}" style="background-color:${PAGE};">
<tr><td align="center" style="padding-top:24px;padding-bottom:24px;padding-left:12px;padding-right:12px;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;">
<tr><td bgcolor="${BRAND}" align="${align}" style="background-color:${BRAND};border-radius:12px 12px 0 0;padding-top:18px;padding-bottom:18px;padding-left:28px;padding-right:28px;">
<table cellpadding="0" cellspacing="0" border="0"><tr>
<td style="padding:0;"><img src="${LOGO}" width="36" height="36" alt="" style="display:block;border:0;border-radius:8px;background-color:#ffffff;"></td>
<td style="padding-left:12px;padding-right:12px;"><span style="${FONT}font-size:20px;line-height:24px;color:#ffffff;font-weight:bold;">Hotzonex Cloud</span></td>
</tr></table>
</td></tr>
${card(
  `<h1 style="margin-top:0;margin-bottom:16px;${FONT}font-size:22px;line-height:28px;color:#111827;">${esc(subject)}</h1>
${para(esc(fill(t.hello, vars)))}
${para(esc(fill(t.added, vars)))}
<table cellpadding="0" cellspacing="0" border="0" style="margin-bottom:16px;">
${row(t.role, esc(role), false)}
${row(t.email, esc(w.to))}
${row(t.login, `<a href="${esc(w.loginUrl)}" style="color:${BRAND};">${esc(w.loginUrl.replace(/^https?:\/\//, ''))}</a>`)}
</table>
${para(esc(t.password), 15, '#1f2937', 24)}`,
  28,
  8,
)}
${card(`${button(w.passwordUrl ?? w.loginUrl, w.passwordUrl ? t.button : t.loginButton)}`, 0, 24)}
${card(
  `${w.passwordUrl ? para(esc(t.chooseNote), 13, '#5b6670', 8) : ''}${para(esc(t.phone), 13, '#5b6670', 8)}${para(esc(t.notYou), 13, '#5b6670', 0)}`,
  0,
  28,
  true,
)}
<tr><td align="${align}" style="padding-top:18px;padding-left:28px;padding-right:28px;">
${para(esc(t.footer), 12, '#6b7280', 0)}
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  const text = [
    'Hotzonex Cloud',
    '',
    '',
    subject.toUpperCase(),
    '',
    fill(t.hello, vars),
    '',
    fill(t.added, vars),
    '',
    `${t.role}: ${role}`,
    `${t.email}: ${w.to}`,
    `${t.login}: ${w.loginUrl}`,
    '',
    t.password,
    ...(w.passwordUrl ? ['', `${t.choose}: ${w.passwordUrl}`, t.chooseNote] : []),
    '',
    t.phone,
    t.notYou,
    '',
    t.footer,
  ].join('\n');

  return { to: w.to, subject, html, text };
}
