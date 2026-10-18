import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const APP_VERSION = new Date().toISOString();

/** Writes dist/sw.js with the list of this build's files, so they can be kept in the browser. */
function serviceWorker(): Plugin {
  return {
    name: 'hzc-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const files = Object.keys(bundle)
        .filter((f) => !f.endsWith('.html') && !f.endsWith('.map'))
        .concat(['favicon.png', 'icon-72.png', 'icon-192.png', 'logo.png'])
        .map((f) => `/${f}`)
        .sort();
      const version = createHash('sha256').update(files.join('\n')).digest('hex').slice(0, 12);
      const source = readFileSync(new URL('./service-worker.js', import.meta.url), 'utf8')
        .replace("'__VERSION__'", JSON.stringify(version))
        .replace('__FILES__', JSON.stringify(files));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
      // The live version, read by the open app (lib/appUpdate.ts) to notice an update.
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ version: APP_VERSION }) });
    },
  };
}

/**
 * Content-Security-Policy for the built site (not in development, whose tools need inline scripts):
 * scripts only from the app itself, data only to its Supabase project, no plugins, no foreign forms.
 */
function securityPolicy(): Plugin {
  const hosts = new Set(['tyiwnaxdejtsdofgnuow.supabase.co']);
  const envUrl = process.env.VITE_SUPABASE_URL?.trim();
  if (envUrl && /^https:\/\/[a-z0-9]+\.supabase\.co\/?$/.test(envUrl)) hosts.add(new URL(envUrl).host);
  const api = [...hosts].map((h) => `https://${h} wss://${h}`).join(' ');
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src 'self' ${api}`,
    "worker-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
  return {
    name: 'hzc-security-policy',
    apply: 'build',
    transformIndexHtml: (html) =>
      html.replace(
        '<meta charset="UTF-8" />',
        `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />\n    <meta name="referrer" content="strict-origin-when-cross-origin" />`,
      ),
  };
}

export default defineConfig({
  plugins: [react(), serviceWorker(), securityPolicy()],
  define: { __APP_VERSION__: JSON.stringify(APP_VERSION) },
  server: { port: 5173 },
  build: {
    rollupOptions: {
      output: {
        // Libraries change rarely; a separate chunk stays cached between app updates.
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom', '@tanstack/react-query'],
          supabase: ['@supabase/supabase-js'],
        },
      },
    },
  },
});
