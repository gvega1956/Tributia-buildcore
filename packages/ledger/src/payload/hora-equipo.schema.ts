import { z } from 'zod';
import { zUUID } from '@tributia/shared';

const zDecimal = z.string().regex(/^\d+(\.\d{1,4})?$/, 'Debe ser decimal con hasta 4 decimales');
const zMoneda = z.enum(['DOP', 'USD', 'EUR']);

/**
 * Payload del evento hora_equipo.
 *
 * Emitido por cada equipo-partida en el parte diario confirmado.
 * costoTotal = horasOperadas * tarifaHoraria (tarifa interna del catálogo de equipos).
 * La tarifa se fija al momento del evento — inmutable.
 */
export const zPayloadHoraEquipo = z.object({
  parteDiarioId: zUUID,
  equipoParteId: zUUID,
  proyectoId: zUUID,
  partidaId: zUUID,
  equipoId: zUUID,
  nombreEquipo: z.string().min(1).max(200),
  horasOperadas: zDecimal,
  tarifaHoraria: zDecimal,
  moneda: zMoneda,
  costoTotal: zDecimal,
});

export type PayloadHoraEquipo = z.infer<typeof zPayloadHoraEquipo>;
