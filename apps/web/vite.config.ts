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
    // Workspace packages compilados a CJS — deben estar aquí explícitamente
    // para que Vite los convierta a ESM antes de servirlos al browser.
    include: [
      '@tributia/api-client',
      '@tributia/proyectos',
      '@tributia/compras',
      '@tributia/inventario',
      '@tributia/obra',
      '@tributia/ordenes-cambio',
      '@tributia/contabilidad',
      '@tributia/cxc',
      '@tributia/tesoreria',
    ],
  },
  server: {
    port: 3001,
    strictPort: true,
  },
});
