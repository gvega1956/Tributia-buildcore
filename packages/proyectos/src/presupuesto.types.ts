import { z } from 'zod';

// ── APU ──────────────────────────────────────────────────────────────────────

const zMonto = z
  .string()
  .regex(/^\d+(\.\d{1,4})?$/, 'Formato NUMERIC(18,4): ej. "1250.0000"');

export const TIPOS_LINEA_APU = ['MATERIAL', 'MANO_OBRA', 'EQUIPO', 'SUBCONTRATO'] as const;
export type TipoLineaApu = (typeof TIPOS_LINEA_APU)[number];

export const zApuLineaCreate = z
  .object({
    tipo: z.enum(TIPOS_LINEA_APU),
    insumoId: z.string().uuid().nullish(),
    equipoCatalogoId: z.string().uuid().nullish(),
    descripcion: z.string().max(500).nullish(),
    cantidad: zMonto,
    precioUnitario: zMonto,
    moneda: z.string().length(3).default('DOP'),
    orden: z.number().int().min(1).default(1),
  })
  .refine(
    (d) => d.insumoId || d.equipoCatalogoId || d.descripcion,
    { message: 'Se requiere insumoId, equipoCatalogoId o descripcion en cada línea del APU' },
  );
export type ApuLineaCreateInput = z.infer<typeof zApuLineaCreate>;

export const zApuLineaUpdate = z.object({
  tipo: z.enum(TIPOS_LINEA_APU).optional(),
  insumoId: z.string().uuid().nullish(),
  equipoCatalogoId: z.string().uuid().nullish(),
  descripcion: z.string().max(500).nullish(),
  cantidad: zMonto.optional(),
  precioUnitario: zMonto.optional(),
  orden: z.number().int().min(1).optional(),
});
export type ApuLineaUpdateInput = z.infer<typeof zApuLineaUpdate>;

export const zApuCreate = z.object({
  codigo: z.string().min(1).max(50),
  nombre: z.string().min(1).max(200),
  descripcion: z.string().max(2000).nullish(),
  unidadMedidaId: z.string().uuid().nullish(),
  moneda: z.string().length(3).default('DOP'),
  esBiblioteca: z.boolean().default(false),
  lineas: z.array(zApuLineaCreate).default([]),
});
export type ApuCreateInput = z.infer<typeof zApuCreate>;

export const zApuUpdate = z.object({
  nombre: z.string().min(1).max(200).optional(),
  descripcion: z.string().max(2000).nullish(),
  unidadMedidaId: z.string().uuid().nullish(),
});
export type ApuUpdateInput = z.infer<typeof zApuUpdate>;

// ── Versión de Presupuesto ────────────────────────────────────────────────────

export const TIPOS_VERSION_PRESUPUESTO = ['BORRADOR', 'BASE'] as const;
export type TipoVersionPresupuesto = (typeof TIPOS_VERSION_PRESUPUESTO)[number];

export const ESTADOS_VERSION_PRESUPUESTO = ['PENDIENTE', 'APROBADO', 'RECHAZADO'] as const;
export type EstadoVersionPresupuesto = (typeof ESTADOS_VERSION_PRESUPUESTO)[number];

export const zVersionPresupuestoCreate = z.object({
  nombre: z.string().min(1).max(200),
  tipo: z.enum(TIPOS_VERSION_PRESUPUESTO).default('BORRADOR'),
  notas: z.string().max(2000).nullish(),
  moneda: z.string().length(3).default('DOP'),
  snapshotPartidas: z.boolean().default(true),
});
export type VersionPresupuestoCreateInput = z.infer<typeof zVersionPresupuestoCreate>;

// ── Línea de Presupuesto ──────────────────────────────────────────────────────

export const zLineaPresupuestoCreate = z.object({
  partidaId: z.string().uuid(),
  apuId: z.string().uuid().nullish(),
  cantidad: zMonto,
  precioUnitario: zMonto,
  esIndirecto: z.boolean().default(false),
});
export type LineaPresupuestoCreateInput = z.infer<typeof zLineaPresupuestoCreate>;

export const zLineaPresupuestoUpdate = z.object({
  cantidad: zMonto.optional(),
  precioUnitario: zMonto.optional(),
  esIndirecto: z.boolean().optional(),
});
export type LineaPresupuestoUpdateInput = z.infer<typeof zLineaPresupuestoUpdate>;

export const zAprobarPresupuesto = z.object({
  notas: z.string().max(2000).nullish(),
});
export type AprobarPresupuestoInput = z.infer<typeof zAprobarPresupuesto>;

// ── Importador Excel de Presupuesto ──────────────────────────────────────────

/**
 * Mapeo de columnas del Excel al campo de destino.
 * Cada valor es una letra de columna (A, B, C...) o un número 1-based.
 * Permite adaptar el importador a cualquier formato de Excel de constructora.
 */
export const zMapeoColumnasPresupuesto = z
  .object({
    codigo: z.string().default('A'),
    nombre: z.string().default('B'),
    unidad: z.string().default('C'),
    cantidad: z.string().default('D'),
    precioUnitario: z.string().default('E'),
    esIndirecto: z.string().nullish(),
  })
  .default({});
export type MapeoColumnasPresupuesto = z.infer<typeof zMapeoColumnasPresupuesto>;

export const zImportarPresupuestoInput = z.object({
  versionNombre: z.string().min(1).max(200).default('Presupuesto Importado'),
  mapeo: zMapeoColumnasPresupuesto,
  simulacion: z.boolean().default(false),
});
export type ImportarPresupuestoInput = z.infer<typeof zImportarPresupuestoInput>;
