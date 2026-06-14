import { defineConfig, type PluginOption } from 'vitest/config';
import swc from 'unplugin-swc';

export default defineConfig({
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  plugins: [
    // SWC emite emitDecoratorMetadata que NestJS necesita para DI reflection.
    // esbuild (default de Vitest) no lo soporta → ConfigService → undefined.
    swc.vite({
      jsc: {
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
      },
    }) as PluginOption,
  ],
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.integration.spec.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    // Cargar process.env desde la raíz del monorepo (JWT_SECRET, DATABASE_URL, etc.)
    setupFiles: ['./src/test-setup.ts'],
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
  },
});
