import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const SERVER_TARGET = process.env.VITE_SERVER_TARGET ?? 'http://localhost:3001';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      // Forward /api/* to the Express server during dev. Path is preserved
      // (no rewrite) so the server's `/api/health` route is hit as written.
      '/api': {
        target: SERVER_TARGET,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
