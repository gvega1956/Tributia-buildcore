import { z } from 'zod';

export const ESTADOS_PROYECTO = [
  'PROSPECTO',
  'LICITACION',
  'ADJUDICADO',
  'EN_EJECUCION',
  'CIERRE',
  'GARANTIA',
  'CERRADO',
] as const;

export type EstadoProyecto = (typeof ESTADOS_PROYECTO)[number];

export const TIPOS_OBRA = [
  'RESIDENCIAL',
  'COMERCIAL',
  'INDUSTRIAL',
  'VIAL',
  'HIDRAULICO',
  'INSTITUCIONAL',
  'MIXTO',
  'OTRO',
] as const;

export type TipoObra = (typeof TIPOS_OBRA)[number];

/**
 * Mapa de transiciones válidas del ciclo de vida del Proyecto.
 * Solo transiciones hacia adelante; el estado es append-only en su semántica.
 * CERRADO tiene null porque es el estado final.
 */
export const TRANSICIONES_VALIDAS: Record<EstadoProyecto, EstadoProyecto | null> = {
  PROSPECTO:     'LICITACION',
  LICITACION:    'ADJUDICADO',
  ADJUDICADO:    'EN_EJECUCION',
  EN_EJECUCION:  'CIERRE',
  CIERRE:        'GARANTIA',
  GARANTIA:      'CERRADO',
  CERRADO:       null,
} as const;

export class TransicionInvalidaError extends Error {
  constructor(desde: EstadoProyecto, hacia: EstadoProyecto) {
    const siguiente = TRANSICIONES_VALIDAS[desde];
    const esperado = siguiente != null
      ? `la transición válida es ${desde} → ${siguiente}`
      : `${desde} es el estado final; no admite más transiciones`;
    super(`Transición inválida: ${desde} → ${hacia}. ${esperado}.`);
    this.name = 'TransicionInvalidaError';
  }
}

/** Valida que la transición desde → hacia sea la única permitida. Lanza si no. */
export function validarTransicion(desde: EstadoProyecto, hacia: EstadoProyecto): void {
  const siguiente = TRANSICIONES_VALIDAS[desde];
  if (siguiente !== hacia) {
    throw new TransicionInvalidaError(desde, hacia);
  }
}

// ── Zod schemas ──────────────────────────────────────────────────────────────

const zFecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato esperado: YYYY-MM-DD');
const zMoneda = z.string().length(3).toUpperCase();

export const zProyectoCreate = z.object({
  codigo: z.string().min(1).max(50),
  nombre: z.string().min(1).max(200),
  descripcion: z.string().max(2000).nullish(),
  tipoObra: z.enum(TIPOS_OBRA),
  clienteId: z.string().uuid('clienteId debe ser UUID'),
  numeroContrato: z.string().max(100).nullish(),
  montoContrato: z
    .string()
    .regex(/^\d+(\.\d{1,4})?$/, 'Formato numérico inválido para monto')
    .nullish(),
  monedaContrato: zMoneda.default('DOP'),
  fechaInicioPlanificada: zFecha.nullish(),
  fechaFinPlanificada: zFecha.nullish(),
  ubicacionDescripcion: z.string().max(500).nullish(),
  latitud: z.number().min(-90).max(90).nullish(),
  longitud: z.number().min(-180).max(180).nullish(),
});

export type ProyectoCreateInput = z.infer<typeof zProyectoCreate>;

export const zProyectoUpdate = zProyectoCreate.partial();
export type ProyectoUpdateInput = z.infer<typeof zProyectoUpdate>;

export const zTransicionEstado = z.object({
  estado: z.enum(ESTADOS_PROYECTO),
});
export type TransicionEstadoInput = z.infer<typeof zTransicionEstado>;

export const zAsignarEquipo = z.object({
  usuarioId: z.string().uuid(),
  rolId: z.string().uuid(),
});
export type AsignarEquipoInput = z.infer<typeof zAsignarEquipo>;
