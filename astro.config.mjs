// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import cloudflare from '@astrojs/cloudflare';
import { cacheCloudflare } from '@astrojs/cloudflare/cache';
import tailwindcss from '@tailwindcss/vite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The site's own routes (src/site/routes.json: { pattern, entrypoint }), added beside src/pages.
 * @type {import('astro').AstroIntegration}
 */
const siteRoutes = {
  name: 'site-routes',
  hooks: {
    'astro:config:setup': ({ injectRoute }) => {
      for (const route of JSON.parse(fs.readFileSync('src/site/routes.json', 'utf8'))) injectRoute(route);
    },
  },
};

const SITE_PUBLIC = 'src/site/public';
/** @type {Record<string, string>} */
const TYPES = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain', '.pdf': 'application/pdf' };

/**
 * The site's own static files (src/site/public/, laid out like public/): served at the same paths as
 * public/ files, by the dev server and in the build output. A site file wins over a core one.
 * @type {import('astro').AstroIntegration}
 */
const sitePublic = {
  name: 'site-public',
  hooks: {
    'astro:server:setup': ({ server }) => {
      const root = path.resolve(SITE_PUBLIC);
      server.middlewares.use((req, res, next) => {
        const pathname = decodeURIComponent((req.url ?? '').split('?')[0]);
        const file = path.join(root, pathname);
        if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return next();
        res.setHeader('Content-Type', TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream');
        fs.createReadStream(file).pipe(res);
      });
    },
    'astro:build:done': ({ dir }) => {
      if (fs.existsSync(SITE_PUBLIC)) fs.cpSync(SITE_PUBLIC, fileURLToPath(dir), { recursive: true });
    },
  },
};

export default defineConfig({
  output: 'server',
  // A Cloudflare Worker (wrangler.jsonc; its entry is src/worker.ts). astro dev runs it in workerd too,
  // with local bindings (Hyperdrive to the local database, the jobs queue, Images).
  adapter: cloudflare({ imageService: 'passthrough' }),
  integrations: [react(), siteRoutes, sitePublic],
  // Cloudflare's Workers cache keeps the pages (tagged) and purges them after edits (src/lib/cache.ts).
  cache: { provider: cacheCloudflare() },
  // The same check runs in src/middleware.ts, which lets mail apps' one-click unsubscribe through.
  security: { checkOrigin: false },
  trailingSlash: 'ignore',
  build: { format: 'directory' },
  vite: { plugins: [tailwindcss()] },
});
