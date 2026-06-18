import type { paths } from './schema.js';

// Detecta si schema.d.ts es todavía el placeholder de dos rutas.
// El schema real generado por `pnpm gen:api` incluye /api/v1/proyectos (y ~200 más).
// Cuando este tipo resulta un string en vez de `true`, TypeScript emite el error
// cuyo texto contiene exactamente la instrucción de cómo resolverlo.
type _IsRealSchema = '/api/v1/proyectos' extends keyof paths
  ? true
  : 'PLACEHOLDER DETECTADO — ejecuta: pnpm gen:api (con la API y la BD corriendo)';

type _Assert<T extends true> = T;

// Si ves: "Type '"PLACEHOLDER DETECTADO..."' does not satisfy the constraint 'true'."
// → el schema.d.ts es el placeholder. Ejecuta `pnpm gen:api`.
export type _SchemaIsReal = _Assert<_IsRealSchema>;
