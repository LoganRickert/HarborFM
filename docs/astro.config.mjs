import { defineConfig } from 'astro/config';

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
  },
});
