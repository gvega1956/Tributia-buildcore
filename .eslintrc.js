/** @type {import('eslint').Linter.Config} */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint', 'import'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended-type-checked',
  ],
  parserOptions: {
    project: true,
    tsconfigRootDir: __dirname,
  },
  rules: {
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/no-floating-promises': 'error',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          {
            group: ['@tributia/core/src/*'],
            message: 'Import from @tributia/core public index only',
          },
          {
            group: ['@tributia/ledger/src/*'],
            message: 'Import from @tributia/ledger public index only',
          },
          {
            group: ['@tributia/contabilidad/src/*'],
            message: 'Import from @tributia/contabilidad public index only',
          },
          {
            group: ['@tributia/catalogos/src/*'],
            message: 'Import from @tributia/catalogos public index only',
          },
          {
            group: ['@tributia/proyectos/src/*'],
            message: 'Import from @tributia/proyectos public index only',
          },
          {
            group: ['@tributia/compras/src/*'],
            message: 'Import from @tributia/compras public index only',
          },
          {
            group: ['@tributia/inventario/src/*'],
            message: 'Import from @tributia/inventario public index only',
          },
          {
            group: ['@tributia/obra/src/*'],
            message: 'Import from @tributia/obra public index only',
          },
          {
            group: ['@tributia/workflow/src/*'],
            message: 'Import from @tributia/workflow public index only',
          },
          {
            group: ['@tributia/documental/src/*'],
            message: 'Import from @tributia/documental public index only',
          },
          {
            group: ['@tributia/localizacion-do/src/*'],
            message: 'Import from @tributia/localizacion-do public index only',
          },
          {
            group: ['@tributia/shared/src/*'],
            message: 'Import from @tributia/shared public index only',
          },
        ],
      },
    ],
  },
  ignorePatterns: ['dist/', 'node_modules/', '*.js', '*.cjs', '*.mjs'],
  overrides: [
    {
      files: ['apps/api/src/**/*.spec.ts'],
      parserOptions: {
        project: ['./apps/api/tsconfig.spec.json'],
        tsconfigRootDir: __dirname,
      },
    },
    {
      // Integration specs usan supertest + NestJS getHttpServer() que retornan `any` por diseño
      files: ['apps/api/src/**/*.integration.spec.ts'],
      parserOptions: {
        project: ['./apps/api/tsconfig.spec.json'],
        tsconfigRootDir: __dirname,
      },
      rules: {
        '@typescript-eslint/no-unsafe-argument': 'off',
        '@typescript-eslint/no-unsafe-member-access': 'off',
        '@typescript-eslint/no-unsafe-assignment': 'off',
        '@typescript-eslint/no-unsafe-call': 'off',
      },
    },
    {
      // Root-level config files
      files: ['vitest.config.ts'],
      parserOptions: {
        project: ['./tsconfig.json'],
        tsconfigRootDir: __dirname,
      },
    },
    {
      // API config files outside the build tsconfig
      files: ['apps/api/drizzle.config.ts', 'apps/api/vitest-integration.config.ts'],
      parserOptions: {
        project: ['./apps/api/tsconfig.node.json'],
        tsconfigRootDir: __dirname,
      },
    },
    {
      // Scripts y seeds del directorio tools/ — sin typed linting (son scripts manuales, no producción)
      files: ['tools/**/*.ts'],
      parserOptions: {
        project: ['./tools/tsconfig.json'],
        tsconfigRootDir: __dirname,
      },
      rules: {
        // Desactivar reglas que requieren type-checking completo (los módulos externos no están en scope)
        '@typescript-eslint/no-unsafe-call': 'off',
        '@typescript-eslint/no-unsafe-member-access': 'off',
        '@typescript-eslint/no-unsafe-assignment': 'off',
        '@typescript-eslint/no-unsafe-argument': 'off',
        '@typescript-eslint/no-unsafe-return': 'off',
        '@typescript-eslint/no-floating-promises': 'off',
      },
    },
  ],
};
