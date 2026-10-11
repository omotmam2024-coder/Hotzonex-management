// RouterOS script building and report parsing for the cloud connector.
// Pure functions only (no Deno or Supabase APIs) so they run in tests under Node too.
//
// How a router talks to Hotzonex Cloud:
//   1. Its scheduler runs the small "hzc-cloud" script every 30 s (see setupScript).
//   2. The script POSTs plain text lines (acks and reports, see parseReport) to the
//      router-gateway Edge Function with its token in the x-hzc-token header.
//   3. The gateway answers with RouterOS script text, which the router runs. That script
//      writes its results into the global $hzcOut, and sets $hzcMore when the router
//      should call again straight away (so results arrive within a second).
// The response always ends with END_MARKER, so a cut-off download is never run.

export const END_MARKER = '#HZC-END';
export const CONNECTOR_VERSION = '1';

/** Quotes a value as a RouterOS string literal, escaping everything the parser treats specially. */
export function rosStr(value: string): string {
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\$/g, '\\$')
    .replace(/\?/g, '\\?')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t');
  return `"${escaped}"`;
}

/**
 * Seconds → RouterOS time string, e.g. 9000 → "2h30m", 93784 → "1d2h3m4s", 604800 → "1w".
 * The database always stores seconds; this is used only at the router boundary.
 */
export function toRouterOsTime(totalSeconds: number): string {
  if (!Number.isInteger(totalSeconds) || totalSeconds <= 0) throw new Error(`Invalid duration: ${totalSeconds}`);
  const units: [string, number][] = [
    ['w', 604800],
    ['d', 86400],
    ['h', 3600],
    ['m', 60],
    ['s', 1],
  ];
  let rest = totalSeconds;
  let out = '';
  for (const [suffix, size] of units) {
    const n = Math.floor(rest / size);
    if (n > 0) {
      out += `${n}${suffix}`;
      rest -= n * size;
    }
  }
  return out;
}

/**
 * RouterOS time → seconds. Scripts print times as "00:05:12", "1d02:03:04" or "1w2d03:04:05";
 * the "1w2d3h4m5s" form is accepted too.
 */
export function fromRouterOsTime(value: string | undefined | null): number {
  if (!value) return 0;
  const v = value.trim();
  const clock = /^(?:(\d+)w)?(?:(\d+)d)?\s*(\d{1,3}):(\d{2}):(\d{2})(?:\.\d+)?$/.exec(v);
  if (clock) {
    return (
      Number(clock[1] ?? 0) * 604800 + Number(clock[2] ?? 0) * 86400 + Number(clock[3]) * 3600 + Number(clock[4]) * 60 + Number(clock[5])
    );
  }
  const sizes: Record<string, number> = { w: 604800, d: 86400, h: 3600, m: 60, s: 1 };
  let total = 0;
  for (const match of v.matchAll(/(\d+)(ms|[wdhms])/g)) {
    if (match[2] === 'ms') continue;
    total += Number(match[1]) * (sizes[match[2] ?? 's'] ?? 0);
  }
  return total;
}

// ---------------------------------------------------------------------------
// Setup script (pasted once into Winbox → New Terminal)
// ---------------------------------------------------------------------------

/**
 * The connector the router keeps. It is deliberately small: everything else is sent by the
 * gateway on each call, so the logic can be improved without touching the router again.
 * $hzcBusy stops two runs overlapping; a run that died is taken over after about 2 minutes (5 scheduler ticks).
 */
export function connectorSource(gatewayUrl: string, token: string): string {
  return [
    ':global hzcOut',
    ':global hzcMore',
    ':global hzcBusy',
    ':if ([:typeof $hzcOut] != "str") do={ :set hzcOut "" }',
    ':if ([:typeof $hzcBusy] != "num") do={ :set hzcBusy 0 }',
    ':if (($hzcBusy > 0) && ($hzcBusy < 5)) do={ :set hzcBusy ($hzcBusy + 1) } else={',
    '  :set hzcBusy 1',
    `  :local url ${rosStr(gatewayUrl)}`,
    `  :local tok ${rosStr(token)}`,
    '  :local n 0',
    '  :set hzcMore true',
    '  :while (($hzcMore = true) && ($n < 30)) do={',
    '    :set hzcMore false',
    '    :set n ($n + 1)',
    `    :local body ("H|${CONNECTOR_VERSION}\\n" . $hzcOut)`,
    '    :set hzcOut ""',
    '    :do {',
    '      :local r [/tool fetch url=$url http-method=post http-header-field=("content-type: text/plain,x-hzc-token: " . $tok) http-data=$body output=user check-certificate=yes-without-crl as-value]',
    '      :local d ($r->"data")',
    `      :if ([:typeof [:find $d "${END_MARKER}"]] = "num") do={`,
    '        :local f [:parse $d]',
    '        $f',
    '      } else={ :set hzcOut ([:pick $body 4 [:len $body]] . $hzcOut) }',
    '    } on-error={',
    '      :if ([:len $body] < 30000) do={ :set hzcOut ([:pick $body 4 [:len $body]] . $hzcOut) }',
    '    }',
    '  }',
    '  :set hzcBusy 0',
    '}',
  ].join('\n');
}

/**
 * Commands the admin pastes into the router terminal. It first checks that the router already has
 * a running hotspot and lists what it found; without one it stops and changes nothing. The hotspot
 * and its profiles are never changed. Running it again replaces the old connector.
 */
export function setupScript(opts: { routerName: string; gatewayUrl: string; token: string }): string {
  const source = connectorSource(opts.gatewayUrl, opts.token);
  const policy = 'read,write,test,ftp';
  return [
    `:put ${rosStr(`Hotzonex Cloud: checking router ${opts.routerName.replace(/[\r\n]/g, ' ')} (needs RouterOS 7.19 or newer)...`)}`,
    ':if ([:len [/ip hotspot find where disabled=no]] = 0) do={',
    '  :put "Hotzonex Cloud: no running hotspot found. Set up the hotspot first (IP > Hotspot > Hotspot Setup), then paste this script again. Nothing was changed."',
    '} else={',
    '  :foreach i in=[/ip hotspot find where disabled=no] do={ :put ("Hotzonex Cloud: hotspot " . [/ip hotspot get $i name] . " is running on " . [/ip hotspot get $i interface]) }',
    '  :put ("Hotzonex Cloud: " . [:len [/ip hotspot user profile find]] . " user profiles found. They will not be changed.")',
    '  /system scheduler remove [find name="hzc-cloud"]',
    '  /system script remove [find name="hzc-cloud"]',
    `  /system script add name="hzc-cloud" policy=${policy} dont-require-permissions=yes source=${rosStr(source)}`,
    `  /system scheduler add name="hzc-cloud" interval=30s start-time=startup policy=${policy} on-event="/system script run hzc-cloud"`,
    '  /system script run hzc-cloud',
    '  :put "Hotzonex Cloud: connector installed. The router shows Online on the website within a minute."',
    '}',
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Reports sent by the router
// ---------------------------------------------------------------------------
//   H|<connector version>                         every call
//   I|<board>|<version>|<identity>|<uptime>       with each usage report
//   A|<user>|<mac>|<ip>|<uptime>|<bytes-in>|<bytes-out>   one per active session
//   U|<comment>|<uptime>|<bytes-in>|<bytes-out>   hotspot users tagged hzc:<voucher id>
//   UE                                            end of a complete usage report
//   HS|<name>|<interface>|<profile>|<address-pool>|<disabled>   hotspot server   } read-only snapshot of the
//   HP|<name>|<dns-name>|<login-by>              hotspot server profile        } router's own hotspot setup,
//   UP|<name>|<rate-limit>|<shared-users>        hotspot user profile          } sent just before a T line
//   HC|<users>|<active>                          counts                         }
//   T|<job>|<found 0/1>|<servers,>|<dns name>|<board>|<version>|<uptime>   test result
//   P|<job>|<voucher id>|added|already|conflict|error                     push result
//   J|<job>|ok|<detail>  or  J|<job>|err|<detail> other job results
//   R|<voucher id>                                expired voucher removed from the router
//   E|<text>                                      a problem on the router side

export interface ActiveRow {
  code: string;
  mac: string;
  ip: string | null;
  uptime: number;
  bytes_in: number;
  bytes_out: number;
}

export interface UserUsage {
  voucher_id: string;
  uptime: number;
  bytes: number;
}

export interface TestReport {
  job: string;
  found: boolean;
  servers: string[];
  dns: string;
  board: string;
  version: string;
  uptime: string;
}

/** Read-only snapshot of the hotspot setup the admin made on the router (Hotzonex never changes it). */
export interface HotspotInfo {
  servers: { name: string; interface: string; profile: string; address_pool: string; disabled: boolean }[];
  server_profiles: { name: string; dns_name: string; login_by: string }[];
  user_profiles: { name: string; rate_limit: string; shared_users: string }[];
  users: number;
  active: number;
  checked_at: string;
}

export function emptyHotspotInfo(): HotspotInfo {
  return { servers: [], server_profiles: [], user_profiles: [], users: 0, active: 0, checked_at: new Date().toISOString() };
}

export type HotspotChoice = { ok: true; server: string; dns: string } | { ok: false; error: string };

/**
 * Which of the router's own hotspot servers Hotzonex uses: the one chosen for this router, or
 * else the first running one. The hotspot must already exist and be enabled on the router;
 * Hotzonex never creates or changes it.
 */
export function pickHotspot(info: HotspotInfo, wanted: string | null): HotspotChoice {
  const names = info.servers.map((h) => h.name).join(', ');
  if (!info.servers.length) {
    return { ok: false, error: 'No hotspot is set up on this router. Set it up on the router first (Winbox → IP → Hotspot → Hotspot Setup), then check again.' };
  }
  const server = wanted ? info.servers.find((h) => h.name === wanted) : info.servers.find((h) => !h.disabled);
  if (wanted && !server) {
    return { ok: false, error: `Hotspot server "${wanted}" was not found on this router. Hotspot servers on this router: ${names}. Edit the router and choose one of them.` };
  }
  if (!server) {
    return { ok: false, error: `The hotspot on this router is switched off (${names}). Enable it on the router (IP → Hotspot → Servers), then check again.` };
  }
  if (server.disabled) {
    return { ok: false, error: `Hotspot server "${server.name}" is switched off on this router. Enable it (IP → Hotspot → Servers), then check again.` };
  }
  const dns = info.server_profiles.find((p) => p.name === server.profile)?.dns_name ?? '';
  return { ok: true, server: server.name, dns };
}

export interface Report {
  connectorVersion: string | null;
  info: { board: string; version: string; identity: string; uptime: string } | null;
  usage: { sessions: ActiveRow[]; users: UserUsage[] } | null;
  tests: TestReport[];
  pushes: { job: string; voucher: string; result: 'added' | 'already' | 'conflict' | 'error' }[];
  jobs: { job: string; ok: boolean; detail: string }[];
  removed: string[];
  errors: string[];
  hotspot: HotspotInfo | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TAG_RE = /^hzc:([0-9a-f-]{36})$/i;
const int = (v: string | undefined) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
};

export function parseReport(text: string): Report {
  const report: Report = { connectorVersion: null, info: null, usage: null, tests: [], pushes: [], jobs: [], removed: [], errors: [], hotspot: null };
  const hs = () => (report.hotspot ??= emptyHotspotInfo());
  const sessions: ActiveRow[] = [];
  const users: UserUsage[] = [];
  let usageComplete = false;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const f = line.split('|');
    switch (f[0]) {
      case 'H':
        report.connectorVersion = f[1] ?? null;
        break;
      case 'I':
        // Starts a usage report. If an older one was re-sent after a failed call, keep only the newest.
        report.info = { board: f[1] ?? '', version: f[2] ?? '', identity: f[3] ?? '', uptime: f[4] ?? '' };
        sessions.length = 0;
        users.length = 0;
        usageComplete = false;
        break;
      case 'A':
        if (f[1]) {
          sessions.push({
            code: f[1],
            mac: f[2] ?? '',
            ip: f[3] ? f[3] : null,
            uptime: fromRouterOsTime(f[4]),
            bytes_in: int(f[5]),
            bytes_out: int(f[6]),
          });
        }
        break;
      case 'U': {
        const tag = TAG_RE.exec(f[1] ?? '');
        if (tag?.[1]) users.push({ voucher_id: tag[1].toLowerCase(), uptime: fromRouterOsTime(f[2]), bytes: int(f[3]) + int(f[4]) });
        break;
      }
      case 'UE':
        usageComplete = true;
        break;
      case 'HS':
        if (f[1]) hs().servers.push({ name: f[1], interface: f[2] ?? '', profile: f[3] ?? '', address_pool: f[4] ?? '', disabled: f[5] === 'true' || f[5] === 'yes' });
        break;
      case 'HP':
        if (f[1]) hs().server_profiles.push({ name: f[1], dns_name: f[2] ?? '', login_by: f[3] ?? '' });
        break;
      case 'UP':
        if (f[1]) hs().user_profiles.push({ name: f[1], rate_limit: f[2] ?? '', shared_users: f[3] ?? '' });
        break;
      case 'HC':
        hs().users = int(f[1]);
        hs().active = int(f[2]);
        break;
      case 'T':
        if (f[1] && UUID_RE.test(f[1])) {
          report.tests.push({
            job: f[1],
            found: f[2] === '1' || Number(f[2]) > 0,
            servers: (f[3] ?? '').split(',').filter(Boolean),
            dns: f[4] ?? '',
            board: f[5] ?? '',
            version: f[6] ?? '',
            uptime: f[7] ?? '',
          });
        }
        break;
      case 'P':
        if (f[1] && UUID_RE.test(f[1]) && f[2] && UUID_RE.test(f[2]) && ['added', 'already', 'conflict', 'error'].includes(f[3] ?? '')) {
          report.pushes.push({ job: f[1], voucher: f[2].toLowerCase(), result: f[3] as 'added' | 'already' | 'conflict' | 'error' });
        }
        break;
      case 'J':
        if (f[1] && UUID_RE.test(f[1])) report.jobs.push({ job: f[1], ok: f[2] === 'ok', detail: f.slice(3).join('|') });
        break;
      case 'R':
        if (f[1] && UUID_RE.test(f[1])) report.removed.push(f[1].toLowerCase());
        break;
      case 'E':
        report.errors.push(f.slice(1).join('|').slice(0, 300));
        break;
      default:
        break;
    }
  }
  // Only a complete report may replace the live user list (sessions not listed count as ended).
  if (usageComplete) {
    // One row per user and device (the database upserts on that pair).
    const unique = new Map(sessions.map((x) => [`${x.code}|${x.mac}`, x]));
    report.usage = { sessions: [...unique.values()], users };
  }
  return report;
}

// ---------------------------------------------------------------------------
// Commands sent to the router
// ---------------------------------------------------------------------------

/** Wraps commands so a failure is reported instead of stopping the whole response. */
function guarded(body: string, onError: string): string {
  return `:do {\n${body}\n} on-error={ :set hzcOut ($hzcOut . ${rosStr(onError + '\n')}) }`;
}

/** Appends a line to $hzcOut. Parts are RouterOS expressions (already quoted where needed). */
function emit(...parts: string[]): string {
  return `:set hzcOut ($hzcOut . ${parts.join(' . ')} . "\\n")`;
}

export interface ScriptBuilder {
  add(block: string): void;
  more(): void;
  build(): string;
}

export function scriptBuilder(): ScriptBuilder {
  const blocks: string[] = [':global hzcOut', ':global hzcMore'];
  let callAgain = false;
  return {
    add(block: string) {
      blocks.push(block);
    },
    more() {
      callAgain = true;
    },
    build() {
      return [...blocks, ...(callAgain ? [':set hzcMore true'] : []), END_MARKER, ''].join('\n');
    },
  };
}

/** Collects active sessions and voucher counters (only users that have been used, to keep it small). */
export function usageBlock(): string {
  return guarded(
    [
      ':local res [/system resource get]',
      emit('"I|"', '($res->"board-name")', '"|"', '($res->"version")', '"|"', '[/system identity get name]', '"|"', '($res->"uptime")'),
      ':foreach i in=[/ip hotspot active find] do={',
      '  :local a [/ip hotspot active get $i]',
      '  ' + emit('"A|"', '($a->"user")', '"|"', '($a->"mac-address")', '"|"', '($a->"address")', '"|"', '($a->"uptime")', '"|"', '($a->"bytes-in")', '"|"', '($a->"bytes-out")'),
      '}',
      ':foreach i in=[/ip hotspot user find where comment~"^hzc:"] do={',
      '  :local u [/ip hotspot user get $i]',
      '  :if ((($u->"bytes-in") + ($u->"bytes-out")) > 0 || [:tostr ($u->"uptime")] != "00:00:00") do={',
      '    ' + emit('"U|"', '($u->"comment")', '"|"', '($u->"uptime")', '"|"', '($u->"bytes-in")', '"|"', '($u->"bytes-out")'),
      '  }',
      '}',
      emit('"UE"'),
    ].join('\n'),
    'E|usage report failed',
  );
}

/** Checks the hotspot server exists and reads its DNS name, model and version. */
export function testBlock(jobId: string, hotspotServer: string): string {
  return guarded(
    [
      ':foreach i in=[/ip hotspot find] do={',
      '  :local h [/ip hotspot get $i]',
      '  ' + emit('"HS|"', '($h->"name")', '"|"', '($h->"interface")', '"|"', '($h->"profile")', '"|"', '($h->"address-pool")', '"|"', '($h->"disabled")'),
      '}',
      ':foreach i in=[/ip hotspot profile find] do={',
      '  :local h [/ip hotspot profile get $i]',
      '  ' + emit('"HP|"', '($h->"name")', '"|"', '($h->"dns-name")', '"|"', '[:tostr ($h->"login-by")]'),
      '}',
      ':foreach i in=[/ip hotspot user profile find] do={',
      '  :local h [/ip hotspot user profile get $i]',
      '  ' + emit('"UP|"', '($h->"name")', '"|"', '($h->"rate-limit")', '"|"', '($h->"shared-users")'),
      '}',
      emit('"HC|"', '[:len [/ip hotspot user find]]', '"|"', '[:len [/ip hotspot active find]]'),
      `:local s [/ip hotspot find where name=${rosStr(hotspotServer)}]`,
      ':local names ""',
      ':foreach i in=[/ip hotspot find] do={ :set names ($names . [/ip hotspot get $i name] . ",") }',
      ':local dns ""',
      ':if ([:len $s] > 0) do={',
      '  :local p [/ip hotspot get ($s->0) profile]',
      '  :set dns [/ip hotspot profile get [/ip hotspot profile find where name=$p] dns-name]',
      '}',
      ':local res [/system resource get]',
      emit(
        rosStr(`T|${jobId}|`),
        '[:len $s]',
        '"|"',
        '$names',
        '"|"',
        '$dns',
        '"|"',
        '($res->"board-name")',
        '"|"',
        '($res->"version")',
        '"|"',
        '($res->"uptime")',
      ),
    ].join('\n'),
    `J|${jobId}|err|The router could not read its hotspot settings.`,
  );
}

export interface ProfileSpec {
  name: string;
  rateLimit: string | null;
  sharedUsers: number;
}

/**
 * Adds a plan's hotspot user profile only if the router does not have one with that name.
 * A profile the admin already made on the router is never changed.
 */
export function profileCommands(p: ProfileSpec): string {
  const name = rosStr(p.name);
  return [
    `:if ([:len [/ip hotspot user profile find where name=${name}]] = 0) do={`,
    `  /ip hotspot user profile add name=${name} shared-users=${p.sharedUsers}${p.rateLimit ? ` rate-limit=${rosStr(p.rateLimit)}` : ''}`,
    '}',
  ].join('\n');
}

export function syncProfilesBlock(jobId: string, profiles: ProfileSpec[]): string {
  return guarded(
    [...profiles.map(profileCommands), emit(rosStr(`J|${jobId}|ok|${profiles.length}`))].join('\n'),
    `J|${jobId}|err|The router could not save the hotspot profiles.`,
  );
}

export interface PushSpec {
  jobId: string;
  profile: ProfileSpec;
  server: string;
  limitUptime: string;
  limitBytes: string | null;
  vouchers: { id: string; code: string }[];
}

/**
 * Adds vouchers as hotspot users. Idempotent: a user that already exists with this voucher's
 * tag (comment=hzc:<id>) is reported "already"; one with another tag is never touched ("conflict").
 */
export function pushBlock(spec: PushSpec): string {
  const lines = [
    profileCommands(spec.profile),
    ':local add do={',
    '  :global hzcOut',
    '  :local t ("hzc:" . $i)',
    '  :do {',
    '    :local f [/ip hotspot user find where name=$c]',
    '    :if ([:len $f] = 0) do={',
    '      /ip hotspot user add name=$c password=$c profile=$p server=$s limit-uptime=$lu comment=$t',
    '      :if ([:len $lb] > 0) do={ /ip hotspot user set [find where name=$c] limit-bytes-total=$lb }',
    '      :set hzcOut ($hzcOut . "P|" . $j . "|" . $i . "|added\\n")',
    '    } else={',
    '      :if ([/ip hotspot user get ($f->0) comment] = $t) do={',
    '        :set hzcOut ($hzcOut . "P|" . $j . "|" . $i . "|already\\n")',
    '      } else={ :set hzcOut ($hzcOut . "P|" . $j . "|" . $i . "|conflict\\n") }',
    '    }',
    '  } on-error={ :set hzcOut ($hzcOut . "P|" . $j . "|" . $i . "|error\\n") }',
    '}',
  ];
  const shared = `j=${rosStr(spec.jobId)} p=${rosStr(spec.profile.name)} s=${rosStr(spec.server)} lu=${rosStr(spec.limitUptime)} lb=${rosStr(spec.limitBytes ?? '')}`;
  for (const v of spec.vouchers) lines.push(`$add c=${rosStr(v.code)} i=${rosStr(v.id)} ${shared}`);
  return guarded(lines.join('\n'), `J|${spec.jobId}|err|The router could not add the vouchers. Check the hotspot server name.`);
}

/** Disables a voided voucher's user (only the one carrying its tag) and closes its sessions. */
export function disableBlock(jobId: string, voucherId: string, code: string): string {
  const c = rosStr(code);
  const t = rosStr(`hzc:${voucherId}`);
  return guarded(
    [
      `:local f [/ip hotspot user find where name=${c} and comment=${t}]`,
      ':if ([:len $f] > 0) do={ /ip hotspot user set $f disabled=yes }',
      `:local a [/ip hotspot active find where user=${c}]`,
      ':local n [:len $a]',
      ':if ($n > 0) do={ /ip hotspot active remove $a }',
      emit(rosStr(`J|${jobId}|ok|`), '[:len $f]', '","', '$n'),
    ].join('\n'),
    `J|${jobId}|err|The router could not disable this voucher.`,
  );
}

/** Deletes vouchers' hotspot users (only those still carrying the voucher's tag) and their sessions. */
export function removeVouchersBlock(jobId: string, vouchers: { id: string; code: string }[]): string {
  const lines = [':local n 0'];
  for (const v of vouchers) {
    const where = `name=${rosStr(v.code)} and comment=${rosStr(`hzc:${v.id}`)}`;
    lines.push(
      `/ip hotspot active remove [find where user=${rosStr(v.code)}]`,
      `:set n ($n + [:len [/ip hotspot user find where ${where}]])`,
      `/ip hotspot user remove [find where ${where}]`,
    );
  }
  lines.push(emit(rosStr(`J|${jobId}|ok|`), '$n'));
  return guarded(lines.join('\n'), `J|${jobId}|err|The router could not delete the vouchers.`);
}

/** Deletes a user profile only while no hotspot user is on it; reports how many users are on it. */
export function removeProfileBlock(jobId: string, profile: string): string {
  const name = rosStr(profile);
  return guarded(
    [
      `:local n [:len [/ip hotspot user find where profile=${name}]]`,
      `:if ($n = 0) do={ /ip hotspot user profile remove [find where name=${name}] }`,
      emit(rosStr(`J|${jobId}|ok|`), '$n'),
    ].join('\n'),
    `J|${jobId}|err|The router could not delete profile ${profile.replace(/[^0-9A-Za-z _:.-]/g, '')}.`,
  );
}

/** Closes a user's sessions; with a MAC address only that device. */
export function disconnectBlock(jobId: string, code: string, mac: string | null): string {
  const where = `user=${rosStr(code)}${mac ? ` and mac-address=${rosStr(mac.toUpperCase())}` : ''}`;
  return guarded(
    [`:local a [/ip hotspot active find where ${where}]`, ':local n [:len $a]', ':if ($n > 0) do={ /ip hotspot active remove $a }', emit(rosStr(`J|${jobId}|ok|`), '$n')].join(
      '\n',
    ),
    `J|${jobId}|err|The router could not close the session.`,
  );
}

/** Closes sessions whose validity ran out (the router itself does not know about validity). */
export function kickBlock(codes: string[]): string {
  return guarded(codes.map((c) => `/ip hotspot active remove [find where user=${rosStr(c)}]`).join('\n'), 'E|could not close expired sessions');
}

/** Removes expired voucher users that are offline, only when the user still carries this voucher's tag. */
export function removeBlock(items: { id: string; code: string }[]): string {
  return items
    .map((r) => {
      const c = rosStr(r.code);
      return guarded(
        [
          `:if ([:len [/ip hotspot active find where user=${c}]] = 0) do={`,
          `  /ip hotspot user remove [find where name=${c} and comment=${rosStr(`hzc:${r.id}`)}]`,
          `  ${emit(rosStr(`R|${r.id}`))}`,
          '}',
        ].join('\n'),
        `E|could not remove expired voucher ${r.code.replace(/[^0-9A-Za-z]/g, '')}`,
      );
    })
    .join('\n');
}

/**
 * Installs the Hotzonex login portal: downloads every page into a "hotzonex" folder next to the
 * hotspot's current one, and only when all downloads worked points the hotspot server profile's
 * html-directory at it. On any failure nothing is switched. Reports the old and new folder.
 */
export function installPortalBlock(jobId: string, serverProfile: string, filesUrl: string, files: readonly string[]): string {
  const prof = rosStr(serverProfile);
  return guarded(
    [
      `:local cur [/ip hotspot profile get [/ip hotspot profile find where name=${prof}] html-directory]`,
      ':local dir "hotzonex"',
      ':if ([:pick $cur 0 6] = "flash/") do={ :set dir "flash/hotzonex" }',
      ':do { /file add name=$dir type=directory } on-error={}',
      ...files.map(
        (f) => `/tool fetch url=${rosStr(`${filesUrl}&f=${f}`)} dst-path=($dir . ${rosStr(`/${f}`)}) check-certificate=yes-without-crl`,
      ),
      `/ip hotspot profile set [/ip hotspot profile find where name=${prof}] html-directory=$dir`,
      emit(rosStr(`J|${jobId}|ok|`), '$cur', '"|"', '$dir'),
    ].join('\n'),
    `J|${jobId}|err|The router could not download the login pages. Nothing was changed.`,
  );
}

/** Points the hotspot server profile back at the login-page folder it used before. */
export function restorePortalBlock(jobId: string, serverProfile: string, previousDir: string): string {
  const prof = rosStr(serverProfile);
  return guarded(
    [`/ip hotspot profile set [/ip hotspot profile find where name=${prof}] html-directory=${rosStr(previousDir)}`, emit(rosStr(`J|${jobId}|ok|`))].join('\n'),
    `J|${jobId}|err|The router could not switch back to the previous login page.`,
  );
}
