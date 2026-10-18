// Hotzonex Cloud service worker: keeps the app's own files in the browser so it opens at once,
// even after the browser was closed or on a slow connection. Data never comes from here: every
// request to Supabase goes straight to the network. Built into dist/sw.js by vite.config.ts.
const VERSION = '__VERSION__';
const FILES = __FILES__;
const SHELL = `hzc-shell-${VERSION}`;
const ASSETS = 'hzc-assets';
const META = 'hzc-meta';
const SHELL_URL = '/index.html';
const NETWORK_WAIT_MS = 4000;

/** A real built file, not the app page the host sends for an address it does not have. */
function isFile(res) {
  return res.ok && !(res.headers.get('content-type') || '').includes('text/html');
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const shell = await caches.open(SHELL);
      await shell.add(new Request(SHELL_URL, { cache: 'reload' }));
      const assets = await caches.open(ASSETS);
      const have = new Set((await assets.keys()).map((r) => new URL(r.url).pathname));
      await Promise.all(
        FILES.filter((f) => !have.has(f)).map((f) => assets.add(new Request(f, { cache: 'reload' })).catch(() => undefined)),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key.startsWith('hzc-shell-') && key !== SHELL) await caches.delete(key);
      // Files of this version and the previous one are kept: a page still open on the previous
      // version may need one of its files later.
      const meta = await caches.open(META);
      const prevRes = await meta.match('/__previous-files');
      const previous = prevRes ? await prevRes.json() : [];
      const keep = new Set([...FILES, ...previous]);
      const assets = await caches.open(ASSETS);
      for (const req of await assets.keys()) if (!keep.has(new URL(req.url).pathname)) await assets.delete(req);
      await meta.put('/__previous-files', new Response(JSON.stringify(FILES)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Pages: the live app from the network, so an update shows at once (a saved app would ask for
  // page files the server no longer has). The saved copy is used only offline or when the network
  // takes longer than a few seconds.
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        const shell = await caches.open(SHELL);
        const fresh = fetch(SHELL_URL, { cache: 'no-cache' }).then(async (res) => {
          if (res.ok) await shell.put(SHELL_URL, res.clone());
          return res;
        });
        event.waitUntil(fresh.catch(() => undefined));
        const slow = new Promise((resolve) => setTimeout(resolve, NETWORK_WAIT_MS));
        const first = await Promise.race([fresh.catch(() => undefined), slow]);
        if (first) return first;
        const cached = await shell.match(SHELL_URL);
        if (cached) return cached;
        return (await fresh.catch(() => undefined)) ?? Response.error();
      })(),
    );
    return;
  }

  // Built files never change (their names carry a hash): saved copy first.
  if (url.pathname.startsWith('/assets/') || FILES.includes(url.pathname)) {
    event.respondWith(
      (async () => {
        const assets = await caches.open(ASSETS);
        const cached = await assets.match(req);
        if (cached && isFile(cached)) return cached;
        const res = await fetch(req);
        if (isFile(res)) {
          await assets.put(req, res.clone());
          return res;
        }
        // Gone after an update: a clear failure, so the app reloads into the live version.
        return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain' } });
      })(),
    );
  }
});
