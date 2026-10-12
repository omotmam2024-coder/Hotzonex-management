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
    },
  };
}

export default defineConfig({
  plugins: [react(), serviceWorker()],
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
