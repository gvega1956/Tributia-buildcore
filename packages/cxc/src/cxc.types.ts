import { z } from 'zod';

const zUUID = z.string().uuid();
const zDecimal = z.string().regex(/^\d+(\.\d{1,4})?$/, 'Debe ser decimal con máximo 4 decimales');
const zFecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Debe ser YYYY-MM-DD');

// ─── Cubicación / Certificación de avance ─────────────────────────────────────

export const zCubicacionLinea = z.object({
  partidaId: zUUID,
  cantidadPeriodo: zDecimal,
});

export const zCubicacionCreate = z.object({
  empresaId: zUUID,
  proyectoId: zUUID,
  fechaCorte: zFecha,
  lineas: z.array(zCubicacionLinea).min(1, 'Se requiere al menos una partida'),
});

export type CubicacionLineaInput = z.infer<typeof zCubicacionLinea>;
export type CubicacionCreateInput = z.infer<typeof zCubicacionCreate>;

// ─── Factura al cliente ────────────────────────────────────────────────────────

export const zFacturaClienteCreate = z.object({
  cubicacionId: zUUID,
  clienteId: zUUID,
  numero: z.string().min(1).max(30),
  ncf: z.string().min(11).max(19).optional(),
  itbisPct: z.string().regex(/^\d+(\.\d{1,2})?$/).default('18'),
  diasCredito: z.number().int().min(0).max(365).default(30),
});

export type FacturaClienteCreateInput = z.infer<typeof zFacturaClienteCreate>;

// ─── Cobro CxC ────────────────────────────────────────────────────────────────

export const zCobroCxc = z.object({
  monto: zDecimal,
});

export type CobroCxcInput = z.infer<typeof zCobroCxc>;

// ─── Tipos de respuesta (inferidos del API) ───────────────────────────────────

export type EstadoCubicacion = 'BORRADOR' | 'EMITIDA' | 'ANULADA';
export type EstadoFacturaCliente = 'EMITIDA' | 'COBRADA' | 'ANULADA';
export type EstadoCxC = 'PENDIENTE' | 'PARCIAL' | 'COBRADA' | 'VENCIDA';
