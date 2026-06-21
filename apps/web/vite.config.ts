import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  optimizeDeps: {
    // @tributia/proyectos es CJS — Vite lo pre-bundlea a ESM aquí.
    include: ['@tributia/proyectos'],
  },
  server: {
    port: 3001,
    strictPort: true,
  },
});
