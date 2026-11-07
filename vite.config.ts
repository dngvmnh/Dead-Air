import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  // `/` locally; the Pages workflow builds under `/Kiroween/`.
  base: process.env.DEADAIR_BASE ?? '/',
  plugins: [react()],
  server: {
    port: 5173,
  },
  build: {
    target: 'es2022',
  },
});
