import { z } from 'zod';
import { zUUID } from '@tributia/shared';

const zDecimal = z.string().regex(/^\d+(\.\d{1,4})?$/, 'Debe ser decimal con hasta 4 decimales');

export const TIPOS_ALMACEN = ['CENTRAL', 'OBRA', 'TRANSITO'] as const;
export type TipoAlmacen = (typeof TIPOS_ALMACEN)[number];

export const ESTADOS_CONTEO = ['BORRADOR', 'FINALIZADO', 'CANCELADO'] as const;
export type EstadoConteoFisico = (typeof ESTADOS_CONTEO)[number];

export const zAlmacenCreate = z.object({
  empresaId: zUUID,
  proyectoId: zUUID.nullable().optional(),
  tipo: z.enum(TIPOS_ALMACEN),
  codigo: z.string().min(1).max(50),
  nombre: z.string().min(1).max(200),
  ubicacionFisica: z.string().max(500).nullable().optional(),
});

export const zAlmacenUpdate = z.object({
  nombre: z.string().min(1).max(200).optional(),
  ubicacionFisica: z.string().max(500).nullable().optional(),
  activo: z.boolean().optional(),
});

export const zUbicacionCreate = z.object({
  codigo: z.string().min(1).max(50),
  nombre: z.string().min(1).max(200),
});

export const zConteoFisicoCreate = z.object({
  empresaId: zUUID,
  almacenId: zUUID,
  fechaConteo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato YYYY-MM-DD'),
  notas: z.string().max(1000).nullable().optional(),
});

export const zLineaConteoCreate = z.object({
  insumoId: zUUID,
  cantidadFisica: zDecimal,
  costoUnitario: zDecimal,
  moneda: z.string().length(3).default('DOP'),
});

export type AlmacenCreateInput = z.infer<typeof zAlmacenCreate>;
export type AlmacenUpdateInput = z.infer<typeof zAlmacenUpdate>;
export type UbicacionCreateInput = z.infer<typeof zUbicacionCreate>;
export type ConteoFisicoCreateInput = z.infer<typeof zConteoFisicoCreate>;
export type LineaConteoCreateInput = z.infer<typeof zLineaConteoCreate>;
