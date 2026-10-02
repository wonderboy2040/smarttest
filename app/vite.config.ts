import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { readFileSync, writeFileSync } from 'node:fs';

// v20.7.3 FIX (service-worker cache bloat): public/sw.js shipped a frozen
// CACHE_VERSION ('smartai-pro-v20') across every deploy — content-hashed
// chunks accumulated in CacheStorage forever (install/activate never re-ran
// because the SW bytes never changed). This build hook stamps a unique
// per-build suffix into dist/sw.js, so each deploy opens a FRESH cache and
// the SW's activate-eviction deletes the previous one.
const SW_BUILD_STAMP = `b${Date.now().toString(36)}`;
function stampSwVersion() {
  return {
    name: 'stamp-sw-version',
    apply: 'build' as const,
    enforce: 'post' as const,
    closeBundle() {
      try {
        const sw = 'dist/sw.js';
        const src = readFileSync(sw, 'utf8');
        if (src.includes("const CACHE_VERSION = 'smartai-pro-v20';")) {
          writeFileSync(sw, src.replace(
            "const CACHE_VERSION = 'smartai-pro-v20';",
            `const CACHE_VERSION = 'smartai-pro-v20-${SW_BUILD_STAMP}';`,
          ));
        }
      } catch { /* best-effort — dev/preview unaffected */ }
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss(), stampSwVersion()],
  esbuild: {
    ...(process.env.NODE_ENV === 'production' ? { drop: ['console', 'debugger'] } : {}),
    legalComments: 'none',
  },
  build: {
    target: 'es2022',
    minify: 'esbuild',
    cssMinify: 'esbuild',
    sourcemap: false,
    cssCodeSplit: true,
    chunkSizeWarningLimit: 500,
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          // React core — cached long-term
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) {
            return 'vendor-react';
          }
          // Framer Motion / animations
          if (id.includes('node_modules/motion')) {
            return 'vendor-motion';
          }
          // Lucide icons
          if (id.includes('lucide-react')) {
            return 'vendor-icons';
          }
          // Charting library — heavy, load in its own chunk
          if (id.includes('lightweight-charts')) {
            return 'vendor-charts';
          }
          // Portfolio analytics (monthly analytics + return report)
          if (id.includes('utils/portfolioAnalytics')) return 'utils-analytics';
          // Heavy utility modules — split for parallel loading
          if (id.includes('utils/telegram')) return 'utils-telegram';
          if (id.includes('utils/riskEngine') || id.includes('utils/dipEngine')) return 'utils-analysis';
          if (id.includes('utils/wealthEngine')) return 'utils-scanner';
          if (id.includes('utils/tvWebsocket') || id.includes('utils/smartMoney')) return 'utils-market';
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': '/src',
    },
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'motion/react', 'lucide-react'],
  },
  server: {
    hmr: { overlay: true },
    warmup: {
      clientFiles: ['./src/App.tsx', './src/main.tsx'],
    },
    proxy: {
      // /api/* → Node server (port 8080). Includes /api/ml/* for ML engine.
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
        ws: true,
      },
    },
  },
  preview: {
    port: 5173,
    host: '0.0.0.0',
    strictPort: true,
    // v18.1 FIX: `vite preview` previously served ONLY static assets — every
    // /api call 404'd, so "build && preview" could never be used as a cheap
    // prod-parity smoke test. Proxy /api exactly like the dev server does.
    proxy: {
      '/api': {
        target: process.env.PREVIEW_API_TARGET || 'http://localhost:8080',
        changeOrigin: true,
        ws: true,
      },
    },
  },
});