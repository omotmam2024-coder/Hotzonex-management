// Emails Hotzonex Cloud sends itself (not Supabase Auth's own emails), through Resend's API.
// The Edge Function secret RESEND_API_KEY must be set; EMAIL_FROM is optional (a verified sender
// on Resend). Pure functions with the HTTP call passed in, so they run in tests under Node too.

export type EmailLang = 'en' | 'ar' | 'sw';

export const DEFAULT_FROM = 'Hotzonex Cloud <no-reply@mail.hotzonex.net>';

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
  },
};

function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => vars[k] ?? m);
}

/** The welcome email a new staff member gets: who added them, their role, where to log in. */
export function staffWelcomeEmail(w: WelcomeInput): Email {
  const t = TEXT[w.lang];
  const role = ROLE[w.lang][w.role];
  const dir = w.lang === 'ar' ? 'rtl' : 'ltr';
  const vars = { business: w.business, name: w.name };
  const subject = fill(t.subject, vars);
  const button = (href: string, label: string, primary: boolean) =>
    `<a href="${esc(href)}" style="display:inline-block;padding:12px 20px;border-radius:10px;font-weight:600;text-decoration:none;${
      primary ? 'background:#15479c;color:#ffffff' : 'background:#e8eef9;color:#15479c'
    }">${esc(label)}</a>`;

  const html = `<!doctype html><html lang="${w.lang}" dir="${dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;background:#f1f5f9;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#0f172a">
<div style="max-width:520px;margin:0 auto;padding:24px 16px">
<div style="background:#ffffff;border-radius:16px;padding:24px;line-height:1.5">
<p style="margin:0 0 4px;font-size:13px;font-weight:600;color:#15479c">Hotzonex Cloud</p>
<h1 style="margin:0 0 16px;font-size:20px">${esc(subject)}</h1>
<p>${esc(fill(t.hello, vars))}</p>
<p>${esc(fill(t.added, vars))}</p>
<table role="presentation" style="width:100%;border-collapse:collapse;margin:16px 0;font-size:15px">
<tr><td style="padding:6px 0;color:#475569">${esc(t.role)}</td><td style="padding:6px 0;font-weight:600">${esc(role)}</td></tr>
<tr><td style="padding:6px 0;color:#475569">${esc(t.email)}</td><td style="padding:6px 0;font-weight:600" dir="ltr">${esc(w.to)}</td></tr>
<tr><td style="padding:6px 0;color:#475569">${esc(t.login)}</td><td style="padding:6px 0;font-weight:600" dir="ltr"><a href="${esc(w.loginUrl)}" style="color:#15479c">${esc(w.loginUrl.replace(/^https?:\/\//, ''))}</a></td></tr>
</table>
<p>${esc(t.password)}</p>
${w.passwordUrl ? `<p style="margin:16px 0 4px">${button(w.passwordUrl, t.button, true)}</p><p style="margin:0 0 16px;font-size:13px;color:#64748b">${esc(t.chooseNote)}</p>` : ''}
<p style="margin:16px 0">${button(w.loginUrl, t.loginButton, !w.passwordUrl)}</p>
<p style="font-size:13px;color:#64748b">${esc(t.phone)}</p>
</div>
<p style="font-size:12px;color:#94a3b8;text-align:center;margin:16px 0 0">${esc(t.notYou)}</p>
</div></body></html>`;

  const text = [
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
    '',
    t.notYou,
  ].join('\n');

  return { to: w.to, subject, html, text };
}
