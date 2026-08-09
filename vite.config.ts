import legacy from '@vitejs/plugin-legacy';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig(() => ({
  plugins: [
    react(),
    tailwindcss(),
    legacy({
      // Kindle Voyage's experimental browser is much older than Vite's
      // default browser target. Generate an ES5/SystemJS fallback bundle.
      targets: ['ie >= 11', 'Safari >= 8', 'Android >= 4.4'],
      additionalLegacyPolyfills: ['whatwg-fetch'],
      renderLegacyChunks: true,
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  build: {
    // Modern bundle for phones/PC plus legacy bundle from plugin-legacy.
    target: 'es2015',
    sourcemap: true,
  },
  server: {
    host: '0.0.0.0',
    hmr: process.env.DISABLE_HMR !== 'true',
    watch: process.env.DISABLE_HMR === 'true' ? null : {},
  },
}));
