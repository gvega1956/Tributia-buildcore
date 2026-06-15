import { z } from 'zod';
import { zUUID } from '@tributia/shared';

const zDecimal = z.string().regex(/^\d+(\.\d{1,4})?$/, 'Debe ser decimal con hasta 4 decimales');

/**
 * Payload del evento avance_partida.
 *
 * El avance se mide siempre en CANTIDAD ejecutada (m³, m², ml, unidades, etc.),
 * nunca como porcentaje. El % de avance es un cálculo derivado en vivo:
 *   porcentaje = SUM(cantidad_ejecutada) / partida.cantidad_presupuestada
 *
 * Arquitectura P5: la partida es el lenguaje común entre presupuesto y avance.
 */
export const zPayloadAvancePartida = z.object({
  parteDiarioId: zUUID,
  avanceObraId: zUUID,
  proyectoId: zUUID,
  partidaId: zUUID,
  cantidadEjecutada: zDecimal,
  unidad: z.string().min(1).max(50),
  cantidadPresupuestada: zDecimal.optional(), // snapshot para auditoría
});

export type PayloadAvancePartida = z.infer<typeof zPayloadAvancePartida>;
