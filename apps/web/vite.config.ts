import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // Workspace packages compilados a CJS — alias directo al dist
      // para que Vite los resuelva sin depender del hoisting de pnpm.
      '@tributia/shared':   path.resolve(__dirname, '../../packages/shared/dist/index.js'),
      '@tributia/ledger':   path.resolve(__dirname, '../../packages/ledger/dist/index.js'),
      '@tributia/proyectos': path.resolve(__dirname, '../../packages/proyectos/dist/index.js'),
    },
  },
  optimizeDeps: {
    include: ['@tributia/proyectos'],
  },
  server: {
    port: 3001,
    strictPort: true,
  },
});
