import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.integration.spec.ts'],
    testTimeout: 30000, // las pruebas de DB pueden tardar más
    hookTimeout: 30000,
    // Un solo hilo para evitar conflictos en datos de test
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
  },
});
