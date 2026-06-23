import { z } from 'zod';
import { zUUID } from '@tributia/shared';

const zDecimal = z.string().regex(/^\d+(\.\d{1,4})?$/, 'Debe ser decimal con hasta 4 decimales');
const zFecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato YYYY-MM-DD');

// ─── Parte Diario ─────────────────────────────────────────────────────────────

export const CLIMAS = ['SOLEADO', 'NUBLADO', 'PARCIALMENTE_NUBLADO', 'LLUVIOSO', 'TORMENTA'] as const;
export type Clima = (typeof CLIMAS)[number];

export const CLIMA_LABELS: Record<Clima, string> = {
  SOLEADO: 'Soleado',
  NUBLADO: 'Nublado',
  PARCIALMENTE_NUBLADO: 'Parcialmente nublado',
  LLUVIOSO: 'Lluvioso',
  TORMENTA: 'Tormenta',
};

export const TIPOS_PERSONAL = ['PROPIO', 'SUBCONTRATADO'] as const;
export type TipoPersonal = (typeof TIPOS_PERSONAL)[number];

export const zPersonalParteInput = z.object({
  idempotencyKey: z.string().min(1).max(100),
  nombre: z.string().min(1).max(200),
  empleadoId: zUUID.nullable().optional(),
  tipo: z.enum(TIPOS_PERSONAL).default('PROPIO'),
  horasTrabajadas: zDecimal,
  partidaId: zUUID,
  tarifaHoraria: zDecimal,
  moneda: z.enum(['DOP', 'USD', 'EUR']).default('DOP'),
});

export const zEquipoParteInput = z.object({
  idempotencyKey: z.string().min(1).max(100),
  equipoId: zUUID,
  horasOperadas: zDecimal,
  partidaId: zUUID,
  observaciones: z.string().max(500).optional(),
  moneda: z.enum(['DOP', 'USD', 'EUR']).default('DOP'),
});

// avance se mide por CANTIDAD ejecutada, NUNCA por porcentaje libre
export const zAvanceObraInput = z.object({
  idempotencyKey: z.string().min(1).max(100),
  partidaId: zUUID,
  cantidadEjecutada: zDecimal,
  unidad: z.string().min(1).max(50),
  observaciones: z.string().max(500).optional(),
});

export const zParteDiarioCreate = z.object({
  idempotencyKey: z.string().min(1).max(100),
  proyectoId: zUUID,
  empresaId: zUUID,
  fecha: zFecha,
  clima: z.enum(CLIMAS).optional(),
  temperaturaC: zDecimal.optional(),
  notas: z.string().max(2000).optional(),
  personal: z.array(zPersonalParteInput).default([]),
  equipos: z.array(zEquipoParteInput).default([]),
  avances: z.array(zAvanceObraInput).default([]),
});

// ─── RFI ──────────────────────────────────────────────────────────────────────

export const IMPACTOS_RFI = ['NINGUNO', 'DIAS', 'COSTO', 'AMBOS'] as const;
export type ImpactoRfi = (typeof IMPACTOS_RFI)[number];

export const IMPACTO_LABELS: Record<ImpactoRfi, string> = {
  NINGUNO: 'Sin impacto',
  DIAS: 'Días',
  COSTO: 'Costo',
  AMBOS: 'Días y costo',
};

export const zRfiCreate = z.object({
  proyectoId: zUUID,
  titulo: z.string().min(1).max(500),
  descripcion: z.string().min(1),
  impacto: z.enum(IMPACTOS_RFI).default('NINGUNO'),
  impactoDias: z.number().int().positive().optional(),
  impactoMonto: zDecimal.optional(),
  asignadoA: zUUID.optional(),
  fechaLimite: zFecha.optional(),
});

export const zRfiResponder = z.object({
  respuesta: z.string().min(1),
});

// ─── Punch List ───────────────────────────────────────────────────────────────

export const ESTADOS_PUNCH = ['PENDIENTE', 'EN_PROGRESO', 'COMPLETADO', 'RECHAZADO'] as const;
export type EstadoPunch = (typeof ESTADOS_PUNCH)[number];

export const ESTADO_PUNCH_LABELS: Record<EstadoPunch, string> = {
  PENDIENTE: 'Pendiente',
  EN_PROGRESO: 'En progreso',
  COMPLETADO: 'Completado',
  RECHAZADO: 'Rechazado',
};

export const zPunchListCreate = z.object({
  proyectoId: zUUID,
  descripcion: z.string().min(1),
  ubicacion: z.string().max(500).optional(),
  responsableId: zUUID.optional(),
  fechaLimite: zFecha.optional(),
});

export const zPunchListActualizarEstado = z.object({
  estado: z.enum(['EN_PROGRESO', 'COMPLETADO', 'RECHAZADO']),
  evidenciaArchivoId: zUUID.optional(),
});

// ─── Tipos inferidos ──────────────────────────────────────────────────────────

export type PersonalParteInput = z.infer<typeof zPersonalParteInput>;
export type EquipoParteInput = z.infer<typeof zEquipoParteInput>;
export type AvanceObraInput = z.infer<typeof zAvanceObraInput>;
export type ParteDiarioCreateInput = z.infer<typeof zParteDiarioCreate>;
export type RfiCreateInput = z.infer<typeof zRfiCreate>;
export type RfiResponderInput = z.infer<typeof zRfiResponder>;
export type PunchListCreateInput = z.infer<typeof zPunchListCreate>;
export type PunchListActualizarEstadoInput = z.infer<typeof zPunchListActualizarEstado>;
