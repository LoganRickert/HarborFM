import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';

const themesDist = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../harborfm-themes/dist',
);

const CONTENT_TYPES = {
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.zip': 'application/zip',
};

/** Serve harborfm-themes/dist at /theme-gallery during `astro dev`. */
function localThemeGalleryPlugin() {
  return {
    name: 'harborfm-local-theme-gallery',
    configureServer(server) {
      if (!fs.existsSync(themesDist)) return;

      server.middlewares.use((req, res, next) => {
        const raw = req.url?.split('?')[0] ?? '';
        if (!raw.startsWith('/theme-gallery/')) return next();

        const rel = decodeURIComponent(raw.slice('/theme-gallery/'.length));
        if (!rel || rel.includes('..')) return next();

        const filePath = path.join(themesDist, rel);
        if (!filePath.startsWith(themesDist) || !fs.existsSync(filePath)) {
          return next();
        }

        const stat = fs.statSync(filePath);
        if (!stat.isFile()) return next();

        const ext = path.extname(filePath).toLowerCase();
        res.statusCode = 200;
        res.setHeader('Content-Type', CONTENT_TYPES[ext] || 'application/octet-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Content-Length', String(stat.size));
        fs.createReadStream(filePath).pipe(res);
      });
    },
  };
}

export default defineConfig({
  site: 'https://harborfm.com',
  outDir: '../docs-dist',
  build: {
    inlineStylesheets: 'auto',
  },
  vite: {
    build: {
      assetsInlineLimit: 0,
    },
    plugins: [localThemeGalleryPlugin()],
  },
});
