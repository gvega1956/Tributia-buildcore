import { z } from 'zod';
import { zUUID } from '@tributia/shared';

const zDecimal = z.string().regex(/^\d+(\.\d{1,4})?$/, 'Debe ser decimal con hasta 4 decimales');
const zFecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato YYYY-MM-DD');

// ─── Requisición ──────────────────────────────────────────────────────────────

export const zLineaRequisicionCreate = z.object({
  partidaId: zUUID,
  insumoId: zUUID.nullable().optional(),
  descripcion: z.string().min(1).max(500),
  cantidad: zDecimal,
  unidadMedida: z.string().min(1).max(20),
  precioEstimado: zDecimal.optional().default('0.0000'),
  moneda: z.string().length(3).default('DOP'),
});

export const zRequisicionCreate = z.object({
  empresaId: zUUID,
  proyectoId: zUUID,
  fechaRequerida: zFecha.nullable().optional(),
  notas: z.string().max(2000).nullable().optional(),
  lineas: z.array(zLineaRequisicionCreate).min(1),
});

export const zRequisicionAprobar = z.object({});

// ─── Solicitud de Cotización (SOC) ────────────────────────────────────────────

export const zSocCreate = z.object({
  empresaId: zUUID,
  lineaRequisicionIds: z.array(zUUID).min(1),
  terceroIds: z.array(zUUID).min(1),
  fechaVencimiento: zFecha.nullable().optional(),
  notas: z.string().max(2000).nullable().optional(),
});

// ─── Cotización ───────────────────────────────────────────────────────────────

export const zLineaCotizacionCreate = z.object({
  lineaSocId: zUUID,
  precioUnitario: zDecimal,
  cantidad: zDecimal,
  total: zDecimal,
  moneda: z.string().length(3).default('DOP'),
  plazoEntregaDias: z.number().int().positive().nullable().optional(),
});

export const zCotizacionCreate = z.object({
  socId: zUUID,
  terceroId: zUUID,
  numeroCotizacionProveedor: z.string().max(50).nullable().optional(),
  fechaEmision: zFecha.nullable().optional(),
  fechaValidez: zFecha.nullable().optional(),
  condicionesPago: z.string().max(200).nullable().optional(),
  notas: z.string().max(2000).nullable().optional(),
  lineas: z.array(zLineaCotizacionCreate).min(1),
});

// ─── Orden de Compra ──────────────────────────────────────────────────────────

export const zLineaOrdenCompraCreate = z.object({
  partidaId: zUUID,
  insumoId: zUUID.nullable().optional(),
  descripcion: z.string().min(1).max(500),
  cantidad: zDecimal,
  unidadMedida: z.string().min(1).max(20),
  precioUnitario: zDecimal,
  total: zDecimal,
  moneda: z.string().length(3).default('DOP'),
});

export const zOrdenCompraCreate = z.object({
  empresaId: zUUID,
  terceroId: zUUID,
  cotizacionId: zUUID.nullable().optional(),
  fechaEmision: zFecha.nullable().optional(),
  fechaEntregaPrometida: zFecha.nullable().optional(),
  condicionesPago: z.string().max(200).nullable().optional(),
  notas: z.string().max(2000).nullable().optional(),
  lineas: z.array(zLineaOrdenCompraCreate).min(1),
});

export const zOrdenCompraAprobar = z.object({});
export const zOrdenCompraEmitir = z.object({});

// ─── Exported types ───────────────────────────────────────────────────────────

export type LineaRequisicionCreateInput = z.infer<typeof zLineaRequisicionCreate>;
export type RequisicionCreateInput = z.infer<typeof zRequisicionCreate>;
export type SocCreateInput = z.infer<typeof zSocCreate>;
export type LineaCotizacionCreateInput = z.infer<typeof zLineaCotizacionCreate>;
export type CotizacionCreateInput = z.infer<typeof zCotizacionCreate>;
export type LineaOrdenCompraCreateInput = z.infer<typeof zLineaOrdenCompraCreate>;
export type OrdenCompraCreateInput = z.infer<typeof zOrdenCompraCreate>;
