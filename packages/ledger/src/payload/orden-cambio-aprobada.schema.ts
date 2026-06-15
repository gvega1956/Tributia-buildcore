import { z } from 'zod';

const zUUID = z.string().uuid();
const zDecimal = z.string().regex(/^\d+(\.\d{1,4})?$/, 'Formato NUMERIC(18,4)');

const zLineaOcPayload = z.object({
  lineaOrdenCambioId: zUUID,
  partidaId: zUUID.nullable(),
  esPartidaNueva: z.boolean(),
  descripcion: z.string().min(1),
  montoAdicional: zDecimal,
  cantidadAdicional: zDecimal.nullable(),
});

/**
 * Payload del evento orden_cambio_aprobada (§9 arquitectura.md).
 *
 * Emitido por OrdenCambioService.aprobar(). Las proyecciones síncronas
 * usan las lineas para actualizar ejecucion_partida.presupuesto_adicional_oc
 * y cantidad_adicional_oc — actualizando el presupuesto vigente por partida.
 */
export const zPayloadOrdenCambioAprobada = z.object({
  ordenCambioId: zUUID,
  proyectoId: zUUID,
  causa: z.enum(['CLIENTE', 'DISENO', 'CAMPO', 'IMPREVISTO']),
  descripcion: z.string().min(1),
  montoAprobado: zDecimal,
  diasAdicionalesAprobados: z.number().int().nonnegative().nullable(),
  lineas: z.array(zLineaOcPayload),
});

export type PayloadOrdenCambioAprobada = z.infer<typeof zPayloadOrdenCambioAprobada>;
