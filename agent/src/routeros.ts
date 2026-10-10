import { Agent, fetch as undiciFetch } from 'undici';

export interface RouterTarget {
  name: string;
  ip: string;
  port: number;
  useHttps: boolean;
  username: string;
  password: string;
}

export type RouterErrorKind = 'auth' | 'forbidden' | 'unreachable' | 'refused' | 'timeout' | 'not_found' | 'api';

/** A RouterOS failure with a message staff can act on. */
export class RouterError extends Error {
  constructor(
    public readonly kind: RouterErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'RouterError';
  }
}

// Router certificates for www-ssl are normally self-signed on the LAN, so HTTPS
// mode encrypts the traffic but does not verify the certificate chain.
const lanTlsAgent = new Agent({ connect: { rejectUnauthorized: false } });

type Json = Record<string, unknown>;

function causeCode(err: unknown): string | undefined {
  let current: unknown = err;
  for (let depth = 0; depth < 4 && current; depth++) {
    if (typeof current === 'object' && current !== null && 'code' in current) {
      const code = (current as { code: unknown }).code;
      if (typeof code === 'string') return code;
    }
    current = typeof current === 'object' && current !== null && 'cause' in current ? (current as { cause: unknown }).cause : undefined;
  }
  return undefined;
}

/** Minimal RouterOS v7 REST client (basic auth, JSON, one timeout per request). */
export class RouterOSClient {
  private readonly baseUrl: string;
  private readonly authHeader: string;

  constructor(
    private readonly target: RouterTarget,
    private readonly timeoutMs: number,
  ) {
    const scheme = target.useHttps ? 'https' : 'http';
    const defaultPort = target.useHttps ? 443 : 80;
    const portPart = target.port === defaultPort ? '' : `:${target.port}`;
    this.baseUrl = `${scheme}://${target.ip}${portPart}/rest`;
    this.authHeader = `Basic ${Buffer.from(`${target.username}:${target.password}`).toString('base64')}`;
  }

  get<T = Json[] | Json>(path: string, query?: Record<string, string>): Promise<T> {
    return this.request<T>('GET', path, undefined, query);
  }

  put<T = Json>(path: string, body: Json): Promise<T> {
    return this.request<T>('PUT', path, body);
  }

  patch<T = Json>(path: string, body: Json): Promise<T> {
    return this.request<T>('PATCH', path, body);
  }

  post<T = Json>(path: string, body: Json): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  delete(path: string): Promise<void> {
    return this.request<void>('DELETE', path);
  }

  private async request<T>(method: string, path: string, body?: Json, query?: Record<string, string>): Promise<T> {
    const url = new URL(this.baseUrl + path);
    if (query) for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);

    const init = {
      method,
      headers: {
        Authorization: this.authHeader,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(this.timeoutMs),
    };

    const { ip, port } = this.target;
    let res: { status: number; ok: boolean; text(): Promise<string> };
    try {
      res = this.target.useHttps
        ? await undiciFetch(url, { ...init, dispatcher: lanTlsAgent })
        : await fetch(url, init);
    } catch (err) {
      const code = causeCode(err);
      if ((err as Error)?.name === 'TimeoutError' || code === 'UND_ERR_CONNECT_TIMEOUT' || code === 'ETIMEDOUT')
        throw new RouterError('timeout', `No reply from ${ip}. Check that the router is on and the agent PC is on the same network.`);
      if (code === 'ECONNREFUSED')
        throw new RouterError('refused', `${ip} refused the connection on port ${port}. Turn on the ${this.target.useHttps ? 'www-ssl' : 'www'} service on the router.`);
      if (code === 'EHOSTUNREACH' || code === 'ENETUNREACH' || code === 'EHOSTDOWN')
        throw new RouterError('unreachable', `No reply from ${ip}. The address cannot be reached from the agent PC.`);
      if (code === 'ECONNRESET' || code === 'EPROTO' || code?.startsWith('ERR_SSL'))
        throw new RouterError('unreachable', `${ip} closed the connection. Check the port and the HTTPS setting.`);
      throw new RouterError('unreachable', `No reply from ${ip}.`);
    }

    const text = await res.text();
    if (res.status === 401) throw new RouterError('auth', 'Wrong username or password');
    if (res.status === 403)
      throw new RouterError('forbidden', `User ${this.target.username} is not allowed to use the REST API. Give its group the rest-api, read, write and api policies.`);
    if (!res.ok) {
      let detail = '';
      try {
        const parsed = JSON.parse(text) as { detail?: string; message?: string };
        detail = parsed.detail ?? parsed.message ?? '';
      } catch {
        detail = text.slice(0, 200);
      }
      if (res.status === 404) throw new RouterError('not_found', detail || `Not found on ${ip}: ${path}`);
      throw new RouterError('api', `Router ${ip} answered: ${detail || `HTTP ${res.status}`}`);
    }

    if (!text) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new RouterError('api', `${ip} did not answer like a RouterOS v7 REST API. Check the port.`);
    }
  }
}
