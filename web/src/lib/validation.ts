import { z } from 'zod';

/**
 * Checks for what staff and customers type, in one place. The database and the Edge Functions
 * check the same things again (they decide); these give a clear message before anything is sent.
 */

/** The data if it passes the checks; otherwise throws the first problem as a plain message. */
export function validate<T extends z.ZodTypeAny>(schema: T, data: unknown): z.output<T> {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  throw new Error(result.error.issues[0]?.message ?? 'Please check the form.');
}

const uuid = (message: string) => z.string({ required_error: message }).uuid(message);
const wholeNumber = (message: string) =>
  z.coerce.number({ invalid_type_error: message }).refine((n) => Number.isInteger(n), message);

export const generateVouchersSchema = z.object({
  p_router_id: uuid('Choose a router.'),
  p_plan_id: uuid('Choose a plan.'),
  p_quantity: wholeNumber('Quantity must be from 1 to 1000.').pipe(z.number().min(1, 'Quantity must be from 1 to 1000.').max(1000, 'Quantity must be from 1 to 1000.')),
  p_code_length: wholeNumber('Choose the code length.').pipe(z.number().min(6, 'Codes must have 6 to 10 digits.').max(10, 'Codes must have 6 to 10 digits.')),
});

const password = z.string().min(8, 'Password must be at least 8 characters.').max(72, 'Password is too long (max 72 characters).');
const email = z.string().trim().toLowerCase().max(254, 'Enter a valid email address.').email('Enter a valid email address.');

export const staffSchema = (isNew: boolean) =>
  z
    .object({
      full_name: z.string().trim().min(1, 'Full name is required.').max(80, 'Full name is too long (max 80 characters).'),
      email: isNew ? email : z.string().optional(),
      password: isNew ? password : z.union([z.literal(''), password]),
      role: z.enum(['admin', 'manager', 'seller'], { errorMap: () => ({ message: 'Choose a role.' }) }),
      site_id: z.string(),
    })
    .refine((s) => s.role === 'admin' || s.site_id !== '', { message: 'Managers and sellers must belong to a site.' });

export const routerSchema = (needPassword: boolean) =>
  z.object({
    host: z.string().trim().min(1, 'Enter the router address, for example 192.168.88.1.').max(253, 'The router address is too long.'),
    port: z.coerce
      .number()
      .refine((n) => Number.isInteger(n) && n >= 1 && n <= 65535, 'Port must be a number from 1 to 65535.'),
    username: z.string().trim().min(1, 'Enter the router username.').max(64, 'The username is too long.'),
    password: needPassword
      ? z.string().min(1, 'Enter the router password. Hotzonex logs in to the router through the tunnel.')
      : z.string().max(128, 'The password is too long.'),
    comment: z.string().trim().max(60, 'Comment is too long (max 60 characters).'),
    site_id: z.string().min(1, 'Choose a site.'),
  });

const RATE_RE = /^\d+[kKmMgG]?\/\d+[kKmMgG]?$/;

/** A whole number (blank or invalid input — NaN — gets the same plain message). */
const int = (message: string) => z.number({ invalid_type_error: message, required_error: message }).int(message);

export const planSchema = z.object({
  name: z.string().trim().min(1, 'Plan name is required.').max(60, 'Plan name is too long (max 60 characters).'),
  price_ssp: int('Price must be a whole number of SSP above 0.').positive('Price must be a whole number of SSP above 0.'),
  uptime_seconds: int('Time allowed must be above 0.').positive('Time allowed must be above 0.'),
  validity_seconds: int('Validity must be above 0, or tick "No validity limit".').positive('Validity must be above 0, or tick "No validity limit".').nullable(),
  rate_limit: z
    .string()
    .trim()
    .refine((r) => r === '' || RATE_RE.test(r), 'Speed limit must look like 2M/2M (upload/download), or be empty for no limit.'),
  data_limit_mb: int('Data limit must be a whole number of MB, or empty for no limit.').positive('Data limit must be a whole number of MB, or empty for no limit.').nullable(),
  shared_users: int('Devices per code must be from 1 to 50.').min(1, 'Devices per code must be from 1 to 50.').max(50, 'Devices per code must be from 1 to 50.'),
  router_ids: z.array(z.string()).min(1, 'Tick at least one router for this plan.'),
});

/** A phone number: digits with an optional +, 7 to 15 digits (spaces, dots and dashes allowed). */
const phoneSchema = (message: string) =>
  z
    .string()
    .transform((v) => v.trim().replace(/[\s().-]/g, ''))
    .refine((v) => /^\+?[0-9]{7,15}$/.test(v), message);

export const signupSchema = z.object({
  business_name: z.string().trim().min(2, 'Type your business name.').max(100, 'The business name is too long (max 100 characters).'),
  site_name: z.string().trim().max(80, 'The site name is too long (max 80 characters).'),
  full_name: z.string().trim().min(2, 'Type your name.').max(80, 'Your name is too long (max 80 characters).'),
  phone: phoneSchema('Type a phone number we can reach you on.'),
  email,
  password,
});

export const buyRequestSchema = z.object({
  plan_id: uuid('Choose your card.'),
  phone: phoneSchema('Type the phone number you paid from.'),
  txn_ref: z
    .string()
    .transform((v) => v.trim().replace(/\s+/g, '').toUpperCase())
    .refine((v) => /^[A-Z0-9.-]{4,40}$/.test(v), 'Type the transaction ID from your payment message (letters and digits).'),
});

export const cashHandoverSchema = z.object({
  amount: wholeNumber('Type the amount received.').refine((n) => n !== 0 && Math.abs(n) <= 100_000_000, 'Type the amount received.'),
  note: z.string().trim().max(200, 'The note is too long (max 200 characters).'),
});

export const paymentRefSchema = z
  .string()
  .transform((v) => v.trim().replace(/\s+/g, '').toUpperCase())
  .refine((v) => /^[A-Z0-9.-]{4,40}$/.test(v), 'Type the transaction ID of your payment (letters and digits).');
