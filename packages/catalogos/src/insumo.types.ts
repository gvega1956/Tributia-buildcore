import { z } from 'zod';

export type CategoriaInsumo =
  | 'MATERIAL'
  | 'CONSUMIBLE'
  | 'HERRAMIENTA_MENOR'
  | 'QUIMICO'
  | 'COMBUSTIBLE'
  | 'OTRO';

export const zUnidadMedidaCreate = z.object({
  codigo: z.string().min(1).max(10).toUpperCase(),
  nombre: z.string().min(1).max(80),
  descripcion: z.string().max(300).nullable().default(null),
});

export const zInsumoCreate = z.object({
  codigo: z.string().min(1).max(50),
  nombre: z.string().min(1).max(200),
  descripcion: z.string().max(500).nullable().default(null),
  unidadId: z.string().uuid(),
  categoria: z
    .enum(['MATERIAL', 'CONSUMIBLE', 'HERRAMIENTA_MENOR', 'QUIMICO', 'COMBUSTIBLE', 'OTRO'])
    .default('MATERIAL'),
  codigoDgii: z.string().max(20).nullable().default(null),
});

export const zInsumoUpdate = zInsumoCreate.partial().omit({ codigo: true });

export const zEquivalenciaCreate = z.object({
  unidadOrigenId: z.string().uuid(),
  factor: z.string().regex(/^\d+(\.\d{1,6})?$/, 'Factor debe ser decimal positivo'),
  unidadDestinoId: z.string().uuid(),
});

export type UnidadMedidaCreateInput = z.infer<typeof zUnidadMedidaCreate>;
export type InsumoCreateInput = z.infer<typeof zInsumoCreate>;
export type InsumoUpdateInput = z.infer<typeof zInsumoUpdate>;
export type EquivalenciaCreateInput = z.infer<typeof zEquivalenciaCreate>;
