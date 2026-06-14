import { z } from 'zod';

// ─── Enums de dominio ─────────────────────────────────────────────────────────

export type EstadoFlujo = 'EN_PROGRESO' | 'APROBADO' | 'RECHAZADO' | 'CANCELADO';
export type EstadoAprobacion = 'PENDIENTE' | 'APROBADO' | 'RECHAZADO' | 'DELEGADO' | 'VENCIDO';
export type TipoAprobador = 'USUARIO';

// ─── Configuración: tipo_flujo ────────────────────────────────────────────────

export const zCrearTipoFlujo = z.object({
  tipoDocumento: z.string().min(1).max(50),
  nombre: z.string().min(1).max(200),
  descripcion: z.string().max(500).nullable().default(null),
  // Condición de monto opcional: si el documento tiene monto dentro de [min, max], aplica este flujo.
  // NULL en ambos = aplica para cualquier monto de ese tipo de documento.
  condicionMontoMin: z
    .string()
    .regex(/^\d+(\.\d{1,4})?$/, 'Debe ser decimal positivo')
    .nullable()
    .default(null),
  condicionMontoMax: z
    .string()
    .regex(/^\d+(\.\d{1,4})?$/, 'Debe ser decimal positivo')
    .nullable()
    .default(null),
  monedaCondicion: z.enum(['DOP', 'USD', 'EUR']).nullable().default(null),
});

export type CrearTipoFlujoInput = z.infer<typeof zCrearTipoFlujo>;

// ─── Configuración: paso_flujo ────────────────────────────────────────────────

export const zAgregarPasoFlujo = z.object({
  // Orden de ejecución. Pasos con el mismo orden se ejecutan en PARALELO (todos deben aprobar).
  // Pasos con órdenes distintos se ejecutan secuencialmente.
  orden: z.number().int().min(1),
  nombre: z.string().min(1).max(200),
  // Quién aprueba: solo USUARIO en v1; en el futuro ROL resuelve a lista de usuarios.
  tipoAprobador: z.literal('USUARIO'),
  aprobadorId: z.string().uuid(),
  // Si este paso puede delegarse por el aprobador asignado.
  permiteDelegacion: z.boolean().default(true),
  // Cuántas horas tiene el aprobador antes de que el sistema escale.
  vencimientoHoras: z.number().int().min(1).nullable().default(null),
  // A quién escalar cuando vence. Si null y hay vencimiento, el paso queda VENCIDO sin escalación.
  escalacionAprobadorId: z.string().uuid().nullable().default(null),
});

export type AgregarPasoFlujoInput = z.infer<typeof zAgregarPasoFlujo>;

// ─── Ejecución: iniciar flujo ─────────────────────────────────────────────────

export const zIniciarFlujo = z.object({
  tipoDocumento: z.string().min(1).max(50),
  documentoId: z.string().uuid(),
  documentoTabla: z.string().min(1).max(100),
  // Monto del documento para seleccionar el flujo correcto por condición de monto.
  monto: z.string().regex(/^\d+(\.\d{1,4})?$/).nullable().default(null),
  moneda: z.enum(['DOP', 'USD', 'EUR']).nullable().default(null),
  descripcion: z.string().min(1).max(500),
  // Datos adicionales del módulo iniciador (ej: nombre del proyecto, número de OC).
  metadata: z.record(z.unknown()).nullable().default(null),
});

export type IniciarFlujoInput = z.infer<typeof zIniciarFlujo>;

// ─── Ejecución: aprobar / rechazar ────────────────────────────────────────────

export const zResponderAprobacion = z.object({
  comentario: z.string().max(1000).nullable().default(null),
});

export const zRechazarAprobacion = z.object({
  comentario: z.string().min(1).max(1000),
});

export type ResponderAprobacionInput = z.infer<typeof zResponderAprobacion>;
export type RechazarAprobacionInput = z.infer<typeof zRechazarAprobacion>;

// ─── Ejecución: delegar ───────────────────────────────────────────────────────

export const zDelegarAprobacion = z.object({
  delegadoAId: z.string().uuid(),
  comentario: z.string().max(500).nullable().default(null),
});

export type DelegarAprobacionInput = z.infer<typeof zDelegarAprobacion>;

// ─── Ejecución: cancelar flujo ────────────────────────────────────────────────

export const zCancelarFlujo = z.object({
  motivo: z.string().min(1).max(500),
});

export type CancelarFlujoInput = z.infer<typeof zCancelarFlujo>;
