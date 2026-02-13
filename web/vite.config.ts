import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig(({ mode }) => {
  const isStaging = mode === 'staging';
  return {
    plugins: [react()],
    resolve: {
      alias: { '@': path.resolve(__dirname, 'src') },
    },
    define: isStaging ? { 'process.env.NODE_ENV': '"development"' } : {},
    build: {
      minify: !isStaging,
      sourcemap: isStaging,
      rollupOptions: isStaging
        ? {
            output: {
              manualChunks: undefined,
            },
          }
        : undefined,
    },
    server: {
      port: 5173,
      allowedHosts: true,
      proxy: {
        '/api': {
          target: 'http://localhost:3001',
          changeOrigin: true,
        },
      },
    },
  };
});
