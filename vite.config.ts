import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    build: {
      rollupOptions: {
        output: {
          // Vendor code changes rarely, so it gets its own long-lived cached chunks.
          manualChunks(id: string) {
            if (!id.includes('node_modules')) return undefined;
            if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'react';
            if (id.includes('lucide-react')) return 'icons';
            if (/[\\/]node_modules[\\/](motion|framer-motion|motion-dom|motion-utils)[\\/]/.test(id)) return 'motion';
            return 'vendor';
          },
        },
      },
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // HMR can be disabled for hosted editing environments that manage refreshes themselves.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Persistence changes frequently for presence, chat, and live score updates.
      watch: {
        ignored: ['**/.server-data/**', '**/uploads/**', '**/.admin-state.json'],
      },
    },
  };
});
