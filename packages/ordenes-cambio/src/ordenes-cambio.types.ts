import { z } from 'zod';
import { zUUID } from '@tributia/shared';

const zDecimal = z.string().regex(/^\d+(\.\d{1,4})?$/, 'Debe ser decimal con hasta 4 decimales');

// ─── Causas y estados ─────────────────────────────────────────────────────────

export const CAUSAS_OC = ['CLIENTE', 'DISENO', 'CAMPO', 'IMPREVISTO'] as const;
export type CausaOrdenCambio = (typeof CAUSAS_OC)[number];

export const CAUSA_LABELS: Record<CausaOrdenCambio, string> = {
  CLIENTE: 'Solicitud de cliente',
  DISENO: 'Error de diseño',
  CAMPO: 'Condición de campo',
  IMPREVISTO: 'Imprevisto',
};

export const TIPOS_IMPACTO = ['COSTO', 'PLAZO', 'COSTO_Y_PLAZO'] as const;
export type TipoImpacto = (typeof TIPOS_IMPACTO)[number];

export const TIPO_IMPACTO_LABELS: Record<TipoImpacto, string> = {
  COSTO: 'Solo costo',
  PLAZO: 'Solo plazo',
  COSTO_Y_PLAZO: 'Costo y plazo',
};

export const ESTADOS_OC = ['BORRADOR', 'ENVIADA_CLIENTE', 'APROBADA', 'RECHAZADA', 'ANULADA'] as const;
export type EstadoOrdenCambio = (typeof ESTADOS_OC)[number];

export const ESTADO_OC_LABELS: Record<EstadoOrdenCambio, string> = {
  BORRADOR: 'Borrador',
  ENVIADA_CLIENTE: 'Enviada al cliente',
  APROBADA: 'Aprobada',
  RECHAZADA: 'Rechazada',
  ANULADA: 'Anulada',
};

// ─── Schemas ──────────────────────────────────────────────────────────────────

export const zOrdenCambioCreate = z.object({
  empresaId: zUUID,
  proyectoId: zUUID,
  causa: z.enum(CAUSAS_OC),
  descripcion: z.string().min(1),
  diasAdicionalesSolicitados: z.number().int().positive().optional(),
});

export const zLineaOrdenCambioAdd = z.object({
  partidaId: zUUID.optional(),
  descripcion: z.string().min(1),
  esPartidaNueva: z.boolean().default(false),
  cantidadAdicional: zDecimal.optional(),
  montoAdicional: zDecimal,
  tipoImpacto: z.enum(TIPOS_IMPACTO).default('COSTO'),
});

export const zOrdenCambioAprobar = z.object({
  montoAprobado: zDecimal,
  diasAdicionalesAprobados: z.number().int().positive().optional(),
});

export const zOrdenCambioRechazar = z.object({
  razonRechazo: z.string().min(1),
});

// ─── Tipos inferidos ──────────────────────────────────────────────────────────

export type OrdenCambioCreateInput = z.infer<typeof zOrdenCambioCreate>;
export type LineaOrdenCambioAddInput = z.infer<typeof zLineaOrdenCambioAdd>;
export type OrdenCambioAprobarInput = z.infer<typeof zOrdenCambioAprobar>;
export type OrdenCambioRechazarInput = z.infer<typeof zOrdenCambioRechazar>;
