import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://docs.harborfm.com',
  outDir: '../docs-dist',
  build: {
    inlineStylesheets: 'auto',
  },
  vite: {
    build: {
      assetsInlineLimit: 0,
    },
  },
});
