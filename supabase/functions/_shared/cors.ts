/** The websites that may call these functions from a browser (the app on hotzonex.net, its earlier addresses, and local development). */
const ALLOWED_ORIGINS = new Set([
  'https://www.hotzonex.net',
  'https://hotzonex.net',
  'https://app.hotzonex.net',
  'https://hotzonex-cloud-rum4d.ondigitalocean.app',
  'http://localhost:5173',
  'http://localhost:4173',
]);

/** CORS headers for this request: only allowed websites are named (other pages' browsers refuse the reply). */
export function corsFor(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') ?? '';
  return { ...corsHeaders, 'Access-Control-Allow-Origin': ALLOWED_ORIGINS.has(origin) ? origin : 'https://www.hotzonex.net', Vary: 'Origin' };
}

export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': 'https://www.hotzonex.net',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/** Supabase refuses passwords found in leaked-password lists; say so instead of a general error. */
export const WEAK_PASSWORD = 'This password is too common and easy to guess. Choose a stronger one: at least 8 characters, mixing words, numbers and symbols.';
export function passwordProblem(message: string | undefined): string | null {
  const m = message ?? '';
  if (/weak|easy to guess|pwned|leaked|compromised/i.test(m)) return WEAK_PASSWORD;
  if (/password/i.test(m)) return m;
  return null;
}

/** A failure whose message is safe and useful to show to staff. */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Wraps a handler with CORS preflight, JSON errors and no stack traces in responses. */
export function serveJson(handler: (req: Request) => Promise<unknown>): void {
  Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsFor(req) });
    const res = await (async () => {
      if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405);
      try {
        return json(await handler(req));
      } catch (err) {
        if (err instanceof HttpError) return json({ error: err.message }, err.status);
        console.error(err instanceof Error ? err.message : String(err));
        return json({ error: 'The server could not finish this request. Please try again.' }, 500);
      }
    })();
    for (const [k, v] of Object.entries(corsFor(req))) res.headers.set(k, v);
    return res;
  });
}

export async function readBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new Error();
    return body as Record<string, unknown>;
  } catch {
    throw new HttpError(400, 'The request was not valid JSON.');
  }
}
