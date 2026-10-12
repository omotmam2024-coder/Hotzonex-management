// Direct connection: Hotzonex calls the router's RouterOS v7 REST API at a public IP address or
// DNS name with the router's admin username and password. Used by the router-direct worker.
// Same rules as the cloud connector: read the router's own hotspot setup without changing it,
// add plan profiles only when missing, touch only hotspot users tagged hzc:<voucher id>.
import { emptyHotspotInfo, fromRouterOsTime, type ActiveRow, type HotspotInfo, type ProfileSpec, type UserUsage } from './routeros.ts';

export interface DirectTarget {
  host: string;
  port: number;
  useHttps: boolean;
  username: string;
  password: string;
  /** Tunnel routers: the relay URL to use instead of http(s)://host:port/rest, and its secret header. */
  relay?: { baseUrl: string; secret: string };
}

export type RouterErrorKind = 'auth' | 'forbidden' | 'unreachable' | 'timeout' | 'tls' | 'not_found' | 'api';

/** A RouterOS failure with a message staff can act on. */
export class RouterError extends Error {
  readonly kind: RouterErrorKind;
  constructor(kind: RouterErrorKind, message: string) {
    super(message);
    this.kind = kind;
    this.name = 'RouterError';
  }
}

type Json = Record<string, unknown>;

/** Minimal RouterOS v7 REST client (basic auth, JSON, one timeout per request). */
export class RestClient {
  private readonly baseUrl: string;
  private readonly authHeader: string;
  private readonly target: DirectTarget;
  private readonly timeoutMs: number;

  constructor(target: DirectTarget, timeoutMs = 10_000) {
    this.target = target;
    this.timeoutMs = timeoutMs;
    const scheme = target.useHttps ? 'https' : 'http';
    const defaultPort = target.useHttps ? 443 : 80;
    const host = target.host.includes(':') ? `[${target.host}]` : target.host;
    this.baseUrl = target.relay?.baseUrl ?? `${scheme}://${host}${target.port === defaultPort ? '' : `:${target.port}`}/rest`;
    const bytes = new TextEncoder().encode(`${target.username}:${target.password}`);
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    this.authHeader = `Basic ${btoa(binary)}`;
  }

  /**
   * Reads a menu. Filters and field lists go in a JSON "print" request: RouterOS does not decode
   * URL query strings reliably (commas in .proplist and spaces in names come through mangled).
   */
  get<T = Json[]>(path: string, query?: Record<string, string>): Promise<T> {
    if (!query) return this.request<T>('GET', path);
    const body: Json = {};
    const words: string[] = [];
    for (const [k, v] of Object.entries(query)) {
      if (k === '.proplist') body['.proplist'] = v.split(',');
      else words.push(`${k}=${v}`);
    }
    if (words.length) body['.query'] = words;
    return this.request<T>('POST', `${path}/print`, body);
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

  private async request<T>(method: string, path: string, body?: Json): Promise<T> {
    const url = new URL(this.baseUrl + path);
    const where = `${this.target.host}:${this.target.port}`;
    const relay = this.target.relay;

    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: {
          Authorization: this.authHeader,
          Accept: 'application/json',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...(relay ? { 'X-Hzc-Relay': relay.secret } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      const msg = err instanceof Error ? `${err.name} ${err.message}` : String(err);
      if (relay && /timeout|timed out|abort/i.test(msg)) throw new RouterError('timeout', `No reply from the router through the tunnel (${where}). Check that it has internet.`);
      if (relay) throw new RouterError('unreachable', `The tunnel server could not be reached. Check that the VPS is running. ${msg.slice(0, 120)}`);
      if (/timeout|timed out|abort/i.test(msg)) {
        throw new RouterError('timeout', `No reply from ${where}. The router must be reachable from the internet at this address (public IP or DNS name), with the ${this.target.useHttps ? 'www-ssl' : 'www'} service on this port.`);
      }
      if (/certificate|tls|ssl|handshake/i.test(msg)) {
        throw new RouterError('tls', `The router's HTTPS certificate is not trusted. Give the router a real certificate (for example: /certificate enable-ssl-certificate dns-name=<your IP Cloud name>), or switch HTTPS off.`);
      }
      if (/refused/i.test(msg)) throw new RouterError('unreachable', `${where} refused the connection. Turn on the ${this.target.useHttps ? 'www-ssl' : 'www'} service on the router and allow this port from the internet.`);
      if (/dns|lookup|resolve|not known/i.test(msg)) throw new RouterError('unreachable', `The name ${this.target.host} could not be found. Check the address.`);
      throw new RouterError('unreachable', `Cannot reach ${where}. ${msg.slice(0, 160)}`);
    }

    const text = await res.text();
    if (relay && (res.status === 502 || res.status === 504)) {
      throw new RouterError('timeout', `The router is not connected to the tunnel (${where}). Check that it has internet and that the tunnel script was pasted.`);
    }
    if (relay && res.status === 404 && !text.startsWith('{')) throw new RouterError('api', 'The tunnel server refused the request. Run the install command on the VPS again.');
    if (res.status === 401) throw new RouterError('auth', 'Wrong router username or password.');
    if (res.status === 403) throw new RouterError('forbidden', `User ${this.target.username} may not use the REST API. Its group needs the read, write, api and rest-api policies.`);
    if (!res.ok) {
      let detail = '';
      try {
        const parsed = JSON.parse(text) as { detail?: string; message?: string };
        detail = parsed.detail ?? parsed.message ?? '';
      } catch {
        detail = text.slice(0, 200);
      }
      if (res.status === 404) throw new RouterError('not_found', detail || `Not found on the router: ${path}. RouterOS 7.1 or newer is needed for the REST API.`);
      throw new RouterError('api', `The router answered: ${detail || `HTTP ${res.status}`}`);
    }
    if (!text) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new RouterError('api', `${where} did not answer like a RouterOS v7 REST API. Check the port and the HTTPS setting.`);
    }
  }
}

const s = (v: unknown) => (typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v));
const n = (v: unknown) => {
  const x = Number(v ?? 0);
  return Number.isFinite(x) && x > 0 ? Math.trunc(x) : 0;
};

export interface DirectTest {
  board: string;
  version: string;
  uptime: string;
  hotspot: HotspotInfo;
}

/** Reads the router's own hotspot setup without changing anything. */
export async function directTest(client: RestClient): Promise<DirectTest> {
  const [resource, servers, serverProfiles, userProfiles, users, active] = await Promise.all([
    client.get<Json>('/system/resource'),
    client.get<Json[]>('/ip/hotspot'),
    client.get<Json[]>('/ip/hotspot/profile'),
    client.get<Json[]>('/ip/hotspot/user/profile'),
    client.get<Json[]>('/ip/hotspot/user', { '.proplist': '.id' }),
    client.get<Json[]>('/ip/hotspot/active', { '.proplist': '.id' }),
  ]);
  const hotspot: HotspotInfo = {
    ...emptyHotspotInfo(),
    servers: servers.map((h) => ({
      name: s(h.name),
      interface: s(h.interface),
      profile: s(h.profile),
      address_pool: s(h['address-pool']),
      disabled: s(h.disabled) === 'true' || s(h.disabled) === 'yes',
    })),
    server_profiles: serverProfiles.map((h) => ({ name: s(h.name), dns_name: s(h['dns-name']), login_by: s(h['login-by']) })),
    user_profiles: userProfiles.map((h) => ({ name: s(h.name), rate_limit: s(h['rate-limit']), shared_users: s(h['shared-users']) })),
    users: users.length,
    active: active.length,
  };
  return { board: s(resource['board-name']), version: s(resource.version), uptime: s(resource.uptime), hotspot };
}

/** Adds a plan's user profile only when the router has none with that name. Returns true if added. */
export async function ensureProfileExists(client: RestClient, p: ProfileSpec): Promise<boolean> {
  const existing = await client.get<Json[]>('/ip/hotspot/user/profile', { name: p.name, '.proplist': 'name' });
  if (existing.length) return false;
  try {
    await client.put('/ip/hotspot/user/profile', { name: p.name, 'shared-users': String(p.sharedUsers), ...(p.rateLimit ? { 'rate-limit': p.rateLimit } : {}) });
  } catch (err) {
    // Already there (e.g. made by MikroTicket): it is used as it is, never changed.
    if (err instanceof RouterError && err.kind === 'api' && /already/i.test(err.message)) return false;
    throw err;
  }
  return true;
}

/**
 * Makes the router's profile for a plan Hotzonex manages match the plan: renames it when the
 * plan's name, price or time changed (users on it stay on it), sets its speed and devices per
 * code, or adds it when the router does not have it. Returns what was done.
 */
export async function upsertManagedProfile(
  client: RestClient,
  spec: { name: string; previousName: string; rateLimit: string | null; sharedUsers: number },
): Promise<'added' | 'updated' | 'unchanged'> {
  const rows = await client.get<Json[]>('/ip/hotspot/user/profile', { '.proplist': '.id,name,rate-limit,shared-users' });
  const current = rows.find((r) => s(r.name) === spec.previousName) ?? rows.find((r) => s(r.name) === spec.name);
  const rate = spec.rateLimit ?? '';
  if (!current) {
    await client.put('/ip/hotspot/user/profile', { name: spec.name, 'shared-users': String(spec.sharedUsers), ...(rate ? { 'rate-limit': rate } : {}) });
    return 'added';
  }
  const changes: Record<string, string> = {};
  if (s(current.name) !== spec.name) changes.name = spec.name;
  if (s(current['rate-limit']) !== rate) changes['rate-limit'] = rate;
  if (s(current['shared-users']) !== String(spec.sharedUsers)) changes['shared-users'] = String(spec.sharedUsers);
  if (!Object.keys(changes).length) return 'unchanged';
  await client.post('/ip/hotspot/user/profile/set', { '.id': s(current['.id']), ...changes });
  return 'updated';
}

export type PushResult = 'added' | 'already' | 'conflict' | 'error';

/** Adds one voucher as a hotspot user. Idempotent; never touches a user with another tag. */
export async function pushVoucher(
  client: RestClient,
  v: { id: string; code: string },
  opts: { profile: string; server: string; limitUptime: string; limitBytes: string | null; password?: PasswordStyle },
  existingByName: Map<string, string>,
): Promise<PushResult> {
  const tag = `hzc:${v.id}`;
  const current = existingByName.get(v.code);
  if (current !== undefined) return current === tag ? 'already' : 'conflict';
  try {
    await client.put('/ip/hotspot/user', {
      name: v.code,
      password: opts.password === 'empty' ? '' : v.code,
      profile: opts.profile,
      server: opts.server,
      'limit-uptime': opts.limitUptime,
      ...(opts.limitBytes ? { 'limit-bytes-total': opts.limitBytes } : {}),
      comment: tag,
    });
    existingByName.set(v.code, tag);
    return 'added';
  } catch (err) {
    if (err instanceof RouterError && err.kind === 'api' && /already/i.test(err.message)) {
      const found = await client.get<Json[]>('/ip/hotspot/user', { name: v.code, '.proplist': 'comment' });
      return s(found[0]?.comment) === tag ? 'already' : 'conflict';
    }
    if (err instanceof RouterError && err.kind !== 'api') throw err;
    return 'error';
  }
}

/** How the router's own vouchers are made: password = code, or no password (a PIN, as MikroTicket can do). */
export type PasswordStyle = 'same' | 'empty';

export interface RouterUsers {
  /** Name → comment of every hotspot user (to recognise Hotzonex's own and avoid clashes). */
  comments: Map<string, string>;
  /** Copied from the router's own vouchers, so Hotzonex cards log in on the same login page. */
  passwordStyle: PasswordStyle;
  /** What the decision was based on: own users with an empty password / password = name / readable. */
  sample: { empty: number; same: number; readable: number };
}

/** All hotspot users, read once per push, and how the router's own vouchers are made. */
export async function readRouterUsers(client: RestClient): Promise<RouterUsers> {
  const users = await client.get<Json[]>('/ip/hotspot/user', { '.proplist': 'name,comment,password' });
  const own = users.filter((u) => s(u.name) && s(u.name) !== 'default-trial' && !s(u.comment).startsWith('hzc:'));
  // A password the router does not show (no "sensitive" permission) tells nothing: only shown ones count.
  const readable = own.filter((u) => typeof u.password === 'string');
  const empty = readable.filter((u) => s(u.password) === '').length;
  const same = readable.filter((u) => s(u.password) === s(u.name)).length;
  const passwordStyle: PasswordStyle = readable.length >= 3 && empty > same && empty >= readable.length * 0.6 ? 'empty' : 'same';
  return { comments: new Map(users.map((u) => [s(u.name), s(u.comment)])), passwordStyle, sample: { empty, same, readable: readable.length } };
}

/** Names of the router's user profiles. */
export async function routerProfileNames(client: RestClient): Promise<string[]> {
  const rows = await client.get<Json[]>('/ip/hotspot/user/profile', { '.proplist': 'name' });
  return rows.map((r) => s(r.name)).filter(Boolean);
}

/** MikroTicket's label and price in a profile name ("profile_1Hr-se:-co:1000-…" → 1Hr, 1000), or null. */
function mikroticketKey(name: string): string | null {
  const label = /^profile_(.+?)-se:/.exec(name)?.[1];
  const price = /-co:([0-9]+(?:\.[0-9]+)?)/.exec(name)?.[1];
  return label && price ? `${label}|${Math.round(Number(price))}` : null;
}

/**
 * The router's own profile for a plan: the plan's profile when the router has it, otherwise the
 * router's MikroTicket profile with the same label and price (routers differ in the rest of the
 * name, e.g. validity). Null when the router has no such profile.
 */
export function matchRouterProfile(planProfile: string, routerProfiles: string[]): string | null {
  if (routerProfiles.includes(planProfile)) return planProfile;
  const key = mikroticketKey(planProfile);
  if (!key) return null;
  return routerProfiles.find((n) => mikroticketKey(n) === key) ?? null;
}

/** Something that is already gone (session ended, user removed) counts as done. */
async function ignoreGone(p: Promise<unknown>): Promise<void> {
  try {
    await p;
  } catch (err) {
    if (err instanceof RouterError && (err.kind === 'not_found' || /no such item/i.test(err.message))) return;
    throw err;
  }
}

export async function disableVoucher(client: RestClient, voucherId: string, code: string): Promise<{ disabled: boolean; sessions: number }> {
  const users = await client.get<Json[]>('/ip/hotspot/user', { name: code, '.proplist': '.id,comment,disabled' });
  const user = users.find((u) => s(u.comment) === `hzc:${voucherId}`);
  if (user && s(user.disabled) !== 'true') await ignoreGone(client.post('/ip/hotspot/user/set', { '.id': s(user['.id']), disabled: 'yes' }));
  const sessions = await closeSessions(client, code, null);
  return { disabled: Boolean(user), sessions };
}

export async function closeSessions(client: RestClient, code: string, mac: string | null): Promise<number> {
  const sessions = (await client.get<Json[]>('/ip/hotspot/active', { user: code, '.proplist': '.id,mac-address' })).filter(
    (a) => !mac || s(a['mac-address']).toLowerCase() === mac.toLowerCase(),
  );
  // Menu commands with the id in the body: RouterOS does not reliably decode ids in URL paths.
  if (sessions.length) await ignoreGone(client.post('/ip/hotspot/active/remove', { '.id': sessions.map((a) => s(a['.id'])).join(',') }));
  return sessions.length;
}

/** A hotspot user as Hotzonex counts it: every user on the router, not only Hotzonex vouchers. */
export interface RouterUser {
  name: string;
  profile: string;
  uptime: number;
  comment: string;
}

/**
 * Who is online, the counters of used voucher users (same shape as the cloud report), and every
 * hotspot user on the router (for the user counts and the router-login sales).
 */
export async function readUsage(
  client: RestClient,
): Promise<{ sessions: ActiveRow[]; users: UserUsage[]; allUsers: RouterUser[]; userProfiles: HotspotInfo['user_profiles']; info: Json }> {
  const [info, active, users, profiles] = await Promise.all([
    client.get<Json>('/system/resource'),
    client.get<Json[]>('/ip/hotspot/active', { '.proplist': 'user,mac-address,address,uptime,bytes-in,bytes-out' }),
    client.get<Json[]>('/ip/hotspot/user', { '.proplist': 'name,profile,comment,uptime,bytes-in,bytes-out' }),
    client.get<Json[]>('/ip/hotspot/user/profile', { '.proplist': 'name,rate-limit,shared-users' }),
  ]);
  const userProfiles = profiles.map((h) => ({ name: s(h.name), rate_limit: s(h['rate-limit']), shared_users: s(h['shared-users']) }));
  const unique = new Map<string, ActiveRow>();
  for (const a of active) {
    const code = s(a.user);
    if (!code) continue;
    unique.set(`${code}|${s(a['mac-address'])}`, {
      code,
      mac: s(a['mac-address']),
      ip: s(a.address) || null,
      uptime: fromRouterOsTime(s(a.uptime)),
      bytes_in: n(a['bytes-in']),
      bytes_out: n(a['bytes-out']),
    });
  }
  const usage: UserUsage[] = [];
  for (const u of users) {
    const tag = /^hzc:([0-9a-f-]{36})$/i.exec(s(u.comment));
    if (tag?.[1]) usage.push({ voucher_id: tag[1].toLowerCase(), uptime: fromRouterOsTime(s(u.uptime)), bytes: n(u['bytes-in']) + n(u['bytes-out']) });
  }
  const allUsers = users
    .filter((u) => s(u.name))
    .map((u) => ({ name: s(u.name), profile: s(u.profile), uptime: fromRouterOsTime(s(u.uptime)), comment: s(u.comment) }));
  return { sessions: [...unique.values()], users: usage, allUsers, userProfiles, info };
}

/**
 * Removes user profiles Hotzonex added earlier (hzc-…) that no plan uses any more and no hotspot
 * user is on. The router owner's own profiles are never touched. Returns the removed names.
 */
export async function removeLeftoverProfiles(client: RestClient, keep: Set<string>): Promise<string[]> {
  const [profiles, users] = await Promise.all([
    client.get<Json[]>('/ip/hotspot/user/profile', { '.proplist': '.id,name' }),
    client.get<Json[]>('/ip/hotspot/user', { '.proplist': 'profile' }),
  ]);
  const inUse = new Set(users.map((u) => s(u.profile)));
  const removed: string[] = [];
  for (const p of profiles) {
    const name = s(p.name);
    if (!name.startsWith('hzc-') || keep.has(name) || inUse.has(name)) continue;
    await ignoreGone(client.post('/ip/hotspot/user/profile/remove', { '.id': s(p['.id']) }));
    removed.push(name);
  }
  return removed;
}

/**
 * Deletes vouchers' hotspot users from the router (closing their sessions first). Only a user that
 * still carries the voucher's tag is removed; one that is already gone counts as removed.
 */
export async function removeVoucherUsers(client: RestClient, vouchers: { id: string; code: string }[]): Promise<number> {
  if (!vouchers.length) return 0;
  const users = await client.get<Json[]>('/ip/hotspot/user', { '.proplist': '.id,name,comment' });
  const byTag = new Map(users.map((u) => [`${s(u.name)}|${s(u.comment)}`, s(u['.id'])]));
  let removed = 0;
  for (const v of vouchers) {
    const id = byTag.get(`${v.code}|hzc:${v.id}`);
    await closeSessions(client, v.code, null);
    if (id) {
      await ignoreGone(client.post('/ip/hotspot/user/remove', { '.id': id }));
      removed++;
    }
  }
  return removed;
}

/**
 * Deletes a user profile from the router, but only while no hotspot user is on it. Returns how many
 * users are on it (0 means it is gone now, or was not there).
 */
export async function removeProfileIfUnused(client: RestClient, name: string): Promise<{ removed: boolean; users: number }> {
  const [profiles, users] = await Promise.all([
    client.get<Json[]>('/ip/hotspot/user/profile', { '.proplist': '.id,name' }),
    client.get<Json[]>('/ip/hotspot/user', { '.proplist': 'profile' }),
  ]);
  const onIt = users.filter((u) => s(u.profile) === name).length;
  const profile = profiles.find((p) => s(p.name) === name);
  if (onIt > 0 || !profile) return { removed: false, users: onIt };
  await ignoreGone(client.post('/ip/hotspot/user/profile/remove', { '.id': s(profile['.id']) }));
  return { removed: true, users: 0 };
}

/** Removes an expired voucher user if it is offline and still carries the voucher's tag. Returns true when gone. */
export async function removeExpired(client: RestClient, v: { id: string; code: string }): Promise<boolean> {
  const online = await client.get<Json[]>('/ip/hotspot/active', { user: v.code, '.proplist': '.id' });
  if (online.length) return false;
  const users = await client.get<Json[]>('/ip/hotspot/user', { name: v.code, '.proplist': '.id,comment' });
  const user = users.find((u) => s(u.comment) === `hzc:${v.id}`);
  if (user) await ignoreGone(client.post('/ip/hotspot/user/remove', { '.id': s(user['.id']) }));
  return true;
}

/** The hotspot server profile's current html-directory, read from the full list (no filters needed). */
async function currentHtmlDirectory(client: RestClient, serverProfile: string): Promise<string> {
  let rows: Json[];
  try {
    rows = await client.get<Json[]>('/ip/hotspot/profile');
  } catch (err) {
    throw step('Reading the hotspot profiles', err);
  }
  const found = rows.find((r) => s(r.name) === serverProfile);
  if (!found) throw new RouterError('not_found', `Hotspot profile "${serverProfile}" was not found on the router.`);
  return s(found['html-directory']);
}

/** Switches the hotspot server profile's pages folder; the profile is named, so no internal id is needed. */
async function setHtmlDirectory(client: RestClient, serverProfile: string, dir: string): Promise<void> {
  try {
    await client.post('/ip/hotspot/profile/set', { numbers: serverProfile, 'html-directory': dir });
  } catch (err) {
    throw step(`Switching hotspot profile "${serverProfile}" to folder ${dir}`, err);
  }
}

/** Adds which step failed to a router error, so the message says where it went wrong. */
function step(what: string, err: unknown): Error {
  if (err instanceof RouterError) return new RouterError(err.kind, `${what}: ${err.message}`);
  return err instanceof Error ? err : new Error(String(err));
}

/**
 * Installs the login portal: the router downloads every page into a "hotzonex" folder next to the
 * current one; only when all downloads worked is the hotspot profile switched to it.
 */
export async function installPortalDirect(
  client: RestClient,
  serverProfile: string,
  filesUrl: string,
  files: readonly string[],
): Promise<{ current: string; dir: string }> {
  const current = await currentHtmlDirectory(client, serverProfile);
  const dir = current.startsWith('flash/') ? 'flash/hotzonex' : 'hotzonex';
  for (const f of files) {
    try {
      await client.post('/tool/fetch', { url: `${filesUrl}&f=${f}`, 'dst-path': `${dir}/${f}`, 'check-certificate': 'yes-without-crl' });
    } catch (err) {
      throw step(`Downloading ${f} to the router (nothing was switched)`, err);
    }
  }
  await setHtmlDirectory(client, serverProfile, dir);
  return { current, dir };
}

export async function restorePortalDirect(client: RestClient, serverProfile: string, previousDir: string): Promise<void> {
  await setHtmlDirectory(client, serverProfile, previousDir);
}
