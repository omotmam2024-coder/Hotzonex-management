// Checks for the self sign-up form.
/** A form mistake the person can fix (shown as it is). */
export class InputError extends Error {}

export interface SignupInput {
  businessName: string;
  fullName: string;
  email: string;
  password: string;
  siteName: string;
  timezone: string;
}

const text = (v: unknown) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '');

export function checkSignup(body: Record<string, unknown>): SignupInput {
  const businessName = text(body.business_name);
  if (businessName.length < 2 || businessName.length > 100) throw new InputError('Type your business name.');
  const fullName = text(body.full_name);
  if (fullName.length < 2 || fullName.length > 80) throw new InputError('Type your full name.');
  const email = text(body.email).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) throw new InputError('Enter a valid email address.');
  const password = typeof body.password === 'string' ? body.password : '';
  if (password.length < 8) throw new InputError('Use a password of at least 8 characters.');
  if (password.length > 72) throw new InputError('The password is too long (max 72 characters).');
  if (password.toLowerCase() === email || password.toLowerCase().includes(businessName.toLowerCase())) {
    throw new InputError('Choose a password that is not your email or business name.');
  }
  const siteName = text(body.site_name) || 'Main site';
  if (siteName.length > 80) throw new InputError('The site name is too long.');
  const timezone = text(body.timezone) || 'Africa/Juba';
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone });
  } catch {
    throw new InputError('Choose a valid time zone, for example Africa/Juba.');
  }
  return { businessName, fullName, email, password, siteName, timezone };
}
