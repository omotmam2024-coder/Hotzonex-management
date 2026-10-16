// Copy of supabase/functions/_shared/portal.ts (kept identical by a test) so the web app can preview the portal.
// Hotzonex login portal: MikroTik hotspot HTML pages built from a template and the admin's settings.
// Pure functions (no Deno/Supabase APIs): used by the `portal` Edge Function, the web preview and tests.
//
// The pages are standard RouterOS hotspot pages ($(link-login-only), $(chap-id), …), so any hotspot
// user on the router can log in — Hotzonex vouchers and vouchers made by other tools alike.
// Login works with CHAP (md5.js) or PAP, whichever the hotspot profile allows.

export type PortalTemplate = 'classic' | 'bold' | 'minimal';
export type LoginMode = 'code' | 'userpass';

export interface PortalSettings {
  businessName: string;
  tagline: string;
  primaryColor: string;
  backgroundColor: string;
  logoDataUrl: string | null;
  showPlans: boolean;
  contact: string;
  footer: string;
  /** code: one box for the voucher code ("I have a username and password" reveals a second box for router users); userpass: always two boxes. */
  loginMode: LoginMode;
}

export interface PortalPlan {
  name: string;
  price_ssp: number;
  uptime_seconds: number;
  color: string;
}

export const PORTAL_TEMPLATES: { id: PortalTemplate; name: string; description: string }[] = [
  { id: 'classic', name: 'Classic', description: 'White card on a coloured background' },
  { id: 'bold', name: 'Bold', description: 'Full colour, very large code box — easy for everyone' },
  { id: 'minimal', name: 'Minimal', description: 'Plain and light, loads fastest' },
];

export const DEFAULT_SETTINGS: PortalSettings = {
  businessName: 'Hotzonex WiFi',
  tagline: 'Enter your voucher code to connect',
  primaryColor: '#e11d48',
  backgroundColor: '#0f172a',
  logoDataUrl: null,
  showPlans: true,
  contact: '',
  footer: '',
  loginMode: 'code',
};

/** Files a hotspot html-directory needs. */
export const PORTAL_FILES = ['login.html', 'alogin.html', 'status.html', 'logout.html', 'error.html', 'redirect.html', 'rlogin.html', 'md5.js'] as const;
export type PortalFile = (typeof PORTAL_FILES)[number];

const COLOR_RE = /^#[0-9a-f]{6}$/i;
const LOGO_RE = /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/;
export const MAX_LOGO_LENGTH = 150_000;

/** Fills in defaults and drops anything unsafe (bad colours, non-image logos). */
export function cleanSettings(raw: unknown): PortalSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const text = (k: keyof PortalSettings, max: number) =>
    typeof r[k] === 'string' ? (r[k] as string).slice(0, max) : (DEFAULT_SETTINGS[k] as string);
  const color = (k: 'primaryColor' | 'backgroundColor') => (typeof r[k] === 'string' && COLOR_RE.test(r[k] as string) ? (r[k] as string) : DEFAULT_SETTINGS[k]);
  const logo = typeof r.logoDataUrl === 'string' && r.logoDataUrl.length <= MAX_LOGO_LENGTH && LOGO_RE.test(r.logoDataUrl) ? r.logoDataUrl : null;
  return {
    businessName: text('businessName', 60) || DEFAULT_SETTINGS.businessName,
    tagline: text('tagline', 120),
    primaryColor: color('primaryColor'),
    backgroundColor: color('backgroundColor'),
    logoDataUrl: logo,
    showPlans: typeof r.showPlans === 'boolean' ? r.showPlans : DEFAULT_SETTINGS.showPlans,
    contact: text('contact', 120),
    footer: text('footer', 160),
    loginMode: r.loginMode === 'userpass' ? 'userpass' : 'code',
  };
}

/** Text shown on the page: HTML-escaped, and "$" escaped so RouterOS never reads it as a variable. */
export function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/\$/g, '&#36;');
}

function duration(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d >= 7 && d % 7 === 0 && !h && !m) return `${d / 7} week${d === 7 ? '' : 's'}`;
  const parts = [d ? `${d} day${d === 1 ? '' : 's'}` : '', h ? `${h} hour${h === 1 ? '' : 's'}` : '', m ? `${m} min` : ''].filter(Boolean);
  return parts.join(' ') || `${seconds} s`;
}

/** Readable text colour on a background. */
function onColor(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.6 ? '#0f172a' : '#ffffff';
}

function css(t: PortalTemplate, s: PortalSettings): string {
  const p = s.primaryColor;
  const bg = s.backgroundColor;
  const base = `*{box-sizing:border-box}html{min-height:100%}body{margin:0;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:16px}
.card{width:100%;max-width:420px;text-align:center}.logo{max-width:140px;max-height:90px;margin:0 auto 8px;display:block}
h1{margin:4px 0;font-size:26px}.tag{margin:0 0 18px;opacity:.85}label{display:block;text-align:left;font-weight:600;margin:12px 0 6px}
input{width:100%;font-size:22px;padding:14px;border-radius:12px;border:2px solid #cbd5e1;letter-spacing:2px;text-align:center}
input:focus{outline:none;border-color:${p}}button{width:100%;margin-top:16px;padding:16px;font-size:20px;font-weight:700;border:0;border-radius:12px;background:${p};color:${onColor(p)};cursor:pointer}
.err{background:#fee2e2;color:#991b1b;border-radius:10px;padding:10px;margin:0 0 12px}.ok{font-size:48px;margin:0}
.more{display:inline-block;margin-top:12px;font-size:14px;color:inherit;opacity:.8}
.plans{list-style:none;padding:0;margin:20px 0 0;text-align:left}.plans li{display:flex;align-items:center;gap:10px;padding:10px 0;border-top:1px solid rgba(127,127,127,.25)}
.dot{width:14px;height:14px;border-radius:50%;flex:none}.plans b{margin-left:auto;font-size:18px}.info{margin:10px 0;font-size:16px;line-height:1.6}
.contact,.foot{margin-top:16px;font-size:14px;opacity:.85}`;
  if (t === 'bold') {
    return `${base}html,body{background:${p}}body{color:${onColor(p)}}.card{padding:8px}h1{font-size:32px}
input{font-size:34px;padding:18px;border:0;border-radius:16px;color:#0f172a}button{background:${bg};color:${onColor(bg)};font-size:24px;padding:20px;border-radius:16px}
.plans li{border-color:rgba(255,255,255,.35)}`;
  }
  if (t === 'minimal') {
    return `${base}html,body{background:#ffffff}body{color:#0f172a}.card{border:1px solid #e2e8f0;border-radius:16px;padding:24px}h1{color:${p}}`;
  }
  return `${base}html{background:${bg}}body{background:linear-gradient(160deg,${bg},${p}) fixed;color:#0f172a}.card{background:#fff;border-radius:20px;padding:24px;box-shadow:0 20px 50px rgba(0,0,0,.25)}`;
}

function page(t: PortalTemplate, s: PortalSettings, title: string, body: string, head = ''): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="pragma" content="no-cache"><meta http-equiv="expires" content="-1">${head}
<title>${esc(title)}</title><style>${css(t, s)}</style></head>
<body><main class="card">
${s.logoDataUrl ? `<img class="logo" src="${s.logoDataUrl}" alt="">` : ''}<h1>${esc(s.businessName)}</h1>
${body}
${s.contact ? `<p class="contact">${esc(s.contact)}</p>` : ''}${s.footer ? `<p class="foot">${esc(s.footer)}</p>` : ''}
</main></body></html>
`;
}

function plansList(s: PortalSettings, plans: PortalPlan[]): string {
  if (!s.showPlans || !plans.length) return '';
  const items = plans
    .map(
      (p) =>
        `<li><span class="dot" style="background:${COLOR_RE.test(p.color) ? p.color : '#64748b'}"></span>${esc(p.name)} · ${esc(duration(p.uptime_seconds))}<b>${esc(
          p.price_ssp.toLocaleString('en-US'),
        )} SSP</b></li>`,
    )
    .join('');
  return `<ul class="plans">${items}</ul>`;
}

function loginPage(t: PortalTemplate, s: PortalSettings, plans: PortalPlan[]): string {
  const codeMode = s.loginMode === 'code';
  const body = `<p class="tag">${esc(s.tagline)}</p>
$(if error)<p class="err">$(error)</p>$(endif)
$(if chap-id)<form name="sendin" action="$(link-login-only)" method="post" style="display:none">
<input type="hidden" name="username"><input type="hidden" name="password"><input type="hidden" name="dst" value="$(link-orig)"><input type="hidden" name="popup" value="true">
</form><script src="/md5.js"></script>$(endif)
<form name="login" action="$(link-login-only)" method="post" onsubmit="return hzcLogin()">
<input type="hidden" name="dst" value="$(link-orig)"><input type="hidden" name="popup" value="true">
<label for="u">${codeMode ? 'Voucher code' : 'Username'}</label>
<input id="u" name="username" value="$(username)" autocomplete="off" autocapitalize="off" spellcheck="false" required>
<div id="pw"${codeMode ? ' style="display:none"' : ''}><label for="p">Password</label><input id="p" name="password" type="password" autocomplete="off"></div>
<button type="submit">Connect</button>
${codeMode ? '<a class="more" href="#" onclick="document.getElementById(\'pw\').style.display=\'block\';document.querySelector(\'label[for=u]\').textContent=\'Username\';this.style.display=\'none\';return false;">I have a username and password</a>' : ''}
</form>
${plansList(s, plans)}
<script>
function hzcLogin(){var f=document.login;var u=f.username.value.replace(/\\s+/g,'');if(!u)return false;
var p=f.password.value;${codeMode ? 'if(!p)p=u;' : ''}f.username.value=u;
$(if chap-id)document.sendin.username.value=u;document.sendin.password.value=hexMD5('$(chap-id)'+p+'$(chap-challenge)');document.sendin.submit();return false;
$(else)f.password.value=p;return true;$(endif)}
document.login.username.focus();
</script>`;
  return page(t, s, s.businessName, body);
}

function statusPage(t: PortalTemplate, s: PortalSettings): string {
  const body = `<p class="ok">✅</p><p class="tag">You are connected</p>
<p class="info">Code: <b>$(username)</b><br>Time used: <b>$(uptime)</b>$(if session-time-left)<br>Time left: <b>$(session-time-left)</b>$(endif)<br>Data: $(bytes-in-nice) down / $(bytes-out-nice) up</p>
<form action="$(link-logout)" name="logout" method="post"><input type="hidden" name="erase-cookie" value="on"><button type="submit">Log out</button></form>`;
  return page(t, s, `${s.businessName} – connected`, body, '$(if refresh-timeout)<meta http-equiv="refresh" content="$(refresh-timeout-secs)">$(endif)');
}

function aloginPage(t: PortalTemplate, s: PortalSettings): string {
  const body = `<p class="ok">✅</p><p class="tag">You are connected. Enjoy!</p>
<p class="info"><a class="more" href="$(link-redirect)">Continue</a> · <a class="more" href="$(link-status)">See time left</a></p>`;
  return page(t, s, `${s.businessName} – connected`, body, '<meta http-equiv="refresh" content="2; url=$(link-redirect)">');
}

function logoutPage(t: PortalTemplate, s: PortalSettings): string {
  const body = `<p class="tag">You have logged out.</p>
<p class="info">Code: <b>$(username)</b><br>Time used: <b>$(uptime)</b></p>
<form action="$(link-login)" method="get"><button type="submit">Log in again</button></form>`;
  return page(t, s, `${s.businessName} – logged out`, body);
}

function errorPage(t: PortalTemplate, s: PortalSettings): string {
  const body = `<p class="err">$(error)</p><form action="$(link-login)" method="get"><button type="submit">Back to login</button></form>`;
  return page(t, s, `${s.businessName} – error`, body);
}

// RouterOS reads the first lines of redirect.html / rlogin.html for its HTTP status and Location header.
const REDIRECT = `$(if http-status == 302)Hotspot redirect$(endif)
$(if http-header == "Location")$(link-redirect)$(endif)
<!doctype html><html><head><meta http-equiv="refresh" content="0; url=$(link-redirect)"><meta http-equiv="pragma" content="no-cache"><meta http-equiv="expires" content="-1"></head>
<body><a href="$(link-redirect)">Continue</a></body></html>
`;

const RLOGIN = `$(if http-status == 302)Hotspot login required$(endif)
$(if http-header == "Location")$(link-redirect)$(endif)
<!doctype html><html><head><meta http-equiv="refresh" content="0; url=$(link-redirect)"><meta http-equiv="pragma" content="no-cache"><meta http-equiv="expires" content="-1"></head>
<body><a href="$(link-redirect)">Log in</a></body></html>
`;

/** MD5 for CHAP login (RFC 1321). Characters are treated as bytes, as RouterOS's chap-id is. */
export const MD5_JS = `function hexMD5(s){function a(x,y){var l=(x&65535)+(y&65535);return(((x>>16)+(y>>16)+(l>>16))<<16)|(l&65535)}
function r(n,c){return(n<<c)|(n>>>(32-c))}function q(f,x,y,z,w,s,t){return a(r(a(a(x,f),a(w,t)),s),y)}
function F(x,y,z,w,v,s,t){return q((y&z)|(~y&w),x,y,z,v,s,t)}function G(x,y,z,w,v,s,t){return q((y&w)|(z&~w),x,y,z,v,s,t)}
function H(x,y,z,w,v,s,t){return q(y^z^w,x,y,z,v,s,t)}function I(x,y,z,w,v,s,t){return q(z^(y|~w),x,y,z,v,s,t)}
var n=s.length,b=[],i;for(i=0;i<n;i++)b[i>>2]|=(s.charCodeAt(i)&255)<<((i%4)*8);b[n>>2]|=128<<((n%4)*8);
var L=(((n+8)>>6)+1)*16;for(i=0;i<L;i++)b[i]=b[i]|0;b[L-2]=n*8;
var A=1732584193,B=-271733879,C=-1732584194,D=271733878;
for(i=0;i<L;i+=16){var oa=A,ob=B,oc=C,od=D,k=b.slice(i,i+16);
A=F(A,B,C,D,k[0],7,-680876936);D=F(D,A,B,C,k[1],12,-389564586);C=F(C,D,A,B,k[2],17,606105819);B=F(B,C,D,A,k[3],22,-1044525330);
A=F(A,B,C,D,k[4],7,-176418897);D=F(D,A,B,C,k[5],12,1200080426);C=F(C,D,A,B,k[6],17,-1473231341);B=F(B,C,D,A,k[7],22,-45705983);
A=F(A,B,C,D,k[8],7,1770035416);D=F(D,A,B,C,k[9],12,-1958414417);C=F(C,D,A,B,k[10],17,-42063);B=F(B,C,D,A,k[11],22,-1990404162);
A=F(A,B,C,D,k[12],7,1804603682);D=F(D,A,B,C,k[13],12,-40341101);C=F(C,D,A,B,k[14],17,-1502002290);B=F(B,C,D,A,k[15],22,1236535329);
A=G(A,B,C,D,k[1],5,-165796510);D=G(D,A,B,C,k[6],9,-1069501632);C=G(C,D,A,B,k[11],14,643717713);B=G(B,C,D,A,k[0],20,-373897302);
A=G(A,B,C,D,k[5],5,-701558691);D=G(D,A,B,C,k[10],9,38016083);C=G(C,D,A,B,k[15],14,-660478335);B=G(B,C,D,A,k[4],20,-405537848);
A=G(A,B,C,D,k[9],5,568446438);D=G(D,A,B,C,k[14],9,-1019803690);C=G(C,D,A,B,k[3],14,-187363961);B=G(B,C,D,A,k[8],20,1163531501);
A=G(A,B,C,D,k[13],5,-1444681467);D=G(D,A,B,C,k[2],9,-51403784);C=G(C,D,A,B,k[7],14,1735328473);B=G(B,C,D,A,k[12],20,-1926607734);
A=H(A,B,C,D,k[5],4,-378558);D=H(D,A,B,C,k[8],11,-2022574463);C=H(C,D,A,B,k[11],16,1839030562);B=H(B,C,D,A,k[14],23,-35309556);
A=H(A,B,C,D,k[1],4,-1530992060);D=H(D,A,B,C,k[4],11,1272893353);C=H(C,D,A,B,k[7],16,-155497632);B=H(B,C,D,A,k[10],23,-1094730640);
A=H(A,B,C,D,k[13],4,681279174);D=H(D,A,B,C,k[0],11,-358537222);C=H(C,D,A,B,k[3],16,-722521979);B=H(B,C,D,A,k[6],23,76029189);
A=H(A,B,C,D,k[9],4,-640364487);D=H(D,A,B,C,k[12],11,-421815835);C=H(C,D,A,B,k[15],16,530742520);B=H(B,C,D,A,k[2],23,-995338651);
A=I(A,B,C,D,k[0],6,-198630844);D=I(D,A,B,C,k[7],10,1126891415);C=I(C,D,A,B,k[14],15,-1416354905);B=I(B,C,D,A,k[5],21,-57434055);
A=I(A,B,C,D,k[12],6,1700485571);D=I(D,A,B,C,k[3],10,-1894986606);C=I(C,D,A,B,k[10],15,-1051523);B=I(B,C,D,A,k[1],21,-2054922799);
A=I(A,B,C,D,k[8],6,1873313359);D=I(D,A,B,C,k[15],10,-30611744);C=I(C,D,A,B,k[6],15,-1560198380);B=I(B,C,D,A,k[13],21,1309151649);
A=I(A,B,C,D,k[4],6,-145523070);D=I(D,A,B,C,k[11],10,-1120210379);C=I(C,D,A,B,k[2],15,718787259);B=I(B,C,D,A,k[9],21,-343485551);
A=a(A,oa);B=a(B,ob);C=a(C,oc);D=a(D,od)}
var h='',w=[A,B,C,D];for(i=0;i<16;i++)h+=((w[i>>2]>>>((i%4)*8+4))&15).toString(16)+((w[i>>2]>>>((i%4)*8))&15).toString(16);return h}
`;

/** One portal file, ready to save in the router's hotspot html-directory. */
export function renderPortalFile(file: PortalFile, template: PortalTemplate, rawSettings: unknown, plans: PortalPlan[]): string {
  const s = cleanSettings(rawSettings);
  const t: PortalTemplate = PORTAL_TEMPLATES.some((x) => x.id === template) ? template : 'classic';
  switch (file) {
    case 'login.html':
      return loginPage(t, s, plans);
    case 'alogin.html':
      return aloginPage(t, s);
    case 'status.html':
      return statusPage(t, s);
    case 'logout.html':
      return logoutPage(t, s);
    case 'error.html':
      return errorPage(t, s);
    case 'redirect.html':
      return REDIRECT;
    case 'rlogin.html':
      return RLOGIN;
    case 'md5.js':
      return MD5_JS;
  }
}

/**
 * Evaluates RouterOS hotspot page syntax — $(if x) / $(if x == "v") / $(elif …) / $(else) / $(endif)
 * and $(var) — the way the router does. Used for the preview and in tests.
 */
export function renderLikeRouter(html: string, vars: Record<string, string>): string {
  const parts = html.split(/(\$\((?:if [^)]*|elif [^)]*|else|endif)\))/);
  const truth = (cond: string) => {
    const m = /^(\S+)\s*==\s*"([^"]*)"$/.exec(cond.trim());
    return m ? (vars[m[1]!] ?? '') === m[2] : Boolean(vars[cond.trim()]);
  };
  // Each level: is this branch shown, has an earlier branch been taken, is the parent shown.
  const stack: { show: boolean; taken: boolean; parent: boolean }[] = [];
  let out = '';
  const visible = () => (stack.length ? stack[stack.length - 1]!.show : true);
  for (const part of parts) {
    const tag = /^\$\((if |elif |else|endif)(.*)\)$/.exec(part);
    if (!tag) {
      if (visible()) out += part;
      continue;
    }
    const [, kind, rest] = tag;
    if (kind === 'if ') {
      const parent = visible();
      const ok = parent && truth(rest ?? '');
      stack.push({ show: ok, taken: ok, parent });
    } else if (kind === 'elif ') {
      const top = stack[stack.length - 1];
      if (!top) throw new Error('$(elif) without $(if)');
      const ok = top.parent && !top.taken && truth(rest ?? '');
      top.show = ok;
      top.taken ||= ok;
    } else if (kind === 'else') {
      const top = stack[stack.length - 1];
      if (!top) throw new Error('$(else) without $(if)');
      top.show = top.parent && !top.taken;
      top.taken = true;
    } else {
      if (!stack.pop()) throw new Error('$(endif) without $(if)');
    }
  }
  if (stack.length) throw new Error('$(if) without $(endif)');
  return out.replace(/\$\(([a-z0-9-]+)\)/g, (_, name: string) => vars[name] ?? '');
}

/** Example values for previews. */
export const PREVIEW_VARS: Record<string, string> = {
  'link-login-only': '#',
  'link-orig': '#',
  'link-logout': '#',
  'link-login': '#',
  'link-status': '#',
  'link-redirect': '#',
  username: '',
  uptime: '1h12m',
  'session-time-left': '47m',
  'bytes-in-nice': '320.5 MiB',
  'bytes-out-nice': '18.2 MiB',
  error: '',
};
