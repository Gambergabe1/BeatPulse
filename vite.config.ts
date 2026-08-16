import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
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
