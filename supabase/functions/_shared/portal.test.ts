// Run with: node --test supabase/functions/_shared/portal.test.ts   (Node 22.18+)
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import vm from 'node:vm';
import { cleanSettings, MD5_JS, PORTAL_FILES, PORTAL_TEMPLATES, PREVIEW_VARS, renderLikeRouter, renderPortalFile } from './portal.ts';

const plans = [
  { name: '1 Hour', price_ssp: 1000, uptime_seconds: 3600, color: '#16a34a' },
  { name: '1 Week', price_ssp: 15000, uptime_seconds: 604800, color: '#2563eb' },
];

function md5(s: string): string {
  const ctx = vm.createContext({});
  vm.runInContext(MD5_JS, ctx);
  return (vm.runInContext(`hexMD5(${JSON.stringify(s)})`, ctx) as string);
}

test('md5.js matches real MD5, including byte characters from chap-id', () => {
  for (const s of ['', 'a', 'abc', 'message digest', '\u00e1\u0002\u00ff1234567\u0080', 'x'.repeat(200)]) {
    assert.equal(md5(s), createHash('md5').update(Buffer.from(s, 'latin1')).digest('hex'), JSON.stringify(s));
  }
});

test('router syntax evaluator handles if / elif / else / endif and comparisons', () => {
  const t = '$(if a)A$(elif b)B$(else)C$(endif)|$(if x == "1")one$(endif)|$(v)';
  assert.equal(renderLikeRouter(t, { a: 'y', x: '1', v: 'V' }), 'A|one|V');
  assert.equal(renderLikeRouter(t, { b: 'y' }), 'B||');
  assert.equal(renderLikeRouter(t, {}), 'C||');
  assert.throws(() => renderLikeRouter('$(if a)', {}));
});

test('every template renders every file with balanced router conditions', () => {
  for (const { id } of PORTAL_TEMPLATES) {
    for (const f of PORTAL_FILES) {
      const html = renderPortalFile(f, id, {}, plans);
      assert.ok(html.length > 20, `${id}/${f}`);
      if (f !== 'md5.js') {
        renderLikeRouter(html, PREVIEW_VARS);
        renderLikeRouter(html, { ...PREVIEW_VARS, 'chap-id': '\\341', 'chap-challenge': '\\002', error: 'invalid password' });
      }
    }
  }
});

test('login page uses CHAP when the router offers it and PAP otherwise', () => {
  const html = renderPortalFile('login.html', 'classic', {}, plans);
  const chap = renderLikeRouter(html, { ...PREVIEW_VARS, 'chap-id': '\\341', 'chap-challenge': '\\002' });
  assert.match(chap, /<script src="\/md5.js"><\/script>/);
  assert.match(chap, /hexMD5\('\\341'\+p\+'\\002'\)/);
  assert.match(chap, /document\.sendin\.submit\(\)/);
  const pap = renderLikeRouter(html, PREVIEW_VARS);
  assert.doesNotMatch(pap, /md5\.js|sendin/);
  assert.match(pap, /f\.password\.value=p;return true;/);
});

test('code mode logs in with the code as password unless a password is typed', () => {
  const code = renderLikeRouter(renderPortalFile('login.html', 'bold', { loginMode: 'code' }, plans), PREVIEW_VARS);
  assert.match(code, /if\(!p\)p=u;/);
  assert.match(code, /I have a username and password/);
  assert.match(code, /textContent='Username'/, 'the code box becomes the username box');
  const userpass = renderLikeRouter(renderPortalFile('login.html', 'bold', { loginMode: 'userpass' }, plans), PREVIEW_VARS);
  assert.doesNotMatch(userpass, /if\(!p\)p=u;/);
});

test('error message, plans and prices appear; admin text cannot inject router variables or HTML', () => {
  const html = renderPortalFile('login.html', 'minimal', { businessName: 'Joe $(username) <b>', contact: 'Call 0912' }, plans);
  const out = renderLikeRouter(html, { ...PREVIEW_VARS, username: 'SECRET', error: 'invalid password' });
  assert.match(out, /invalid password/);
  assert.match(out, /15,000 SSP/);
  assert.match(out, /1 week/);
  assert.match(out, /Joe &#36;\(username\) &lt;b&gt;/);
  assert.doesNotMatch(out, /Joe SECRET/);
  assert.match(out, /Call 0912/);
});

test('settings are cleaned: bad colours and non-image logos are dropped', () => {
  const s = cleanSettings({ primaryColor: 'red;}body{', logoDataUrl: 'javascript:alert(1)', showPlans: false, businessName: '' });
  assert.equal(s.primaryColor, '#e11d48');
  assert.equal(s.logoDataUrl, null);
  assert.equal(s.showPlans, false);
  assert.equal(s.businessName, 'Hotzonex WiFi');
});

test('redirect pages start with the lines RouterOS reads for its HTTP status', () => {
  assert.ok(renderPortalFile('redirect.html', 'classic', {}, []).startsWith('$(if http-status == 302)Hotspot redirect$(endif)'));
  assert.ok(renderPortalFile('rlogin.html', 'classic', {}, []).startsWith('$(if http-status == 302)Hotspot login required$(endif)'));
});

test('the web app copy of portal.ts is identical to this one', async () => {
  const { readFileSync } = await import('node:fs');
  const here = readFileSync(new URL('./portal.ts', import.meta.url), 'utf8');
  const web = readFileSync(new URL('../../../web/src/lib/portal.ts', import.meta.url), 'utf8');
  assert.equal(web.split('\n').slice(1).join('\n'), here, 'run: cp supabase/functions/_shared/portal.ts web/src/lib/portal.ts and keep the first comment line');
});
