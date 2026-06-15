import { z } from 'zod';
import { zUUID } from '@tributia/shared';

const zDecimal = z.string().regex(/^\d+(\.\d{1,4})?$/, 'Debe ser decimal con hasta 4 decimales');
const zMoneda = z.enum(['DOP', 'USD', 'EUR']);

/**
 * Payload del evento hora_personal.
 *
 * Emitido cuando el parte diario es confirmado, una fila por trabajador-partida.
 * costoTotal = horasTrabajadas * tarifaHoraria (calculado al momento del parte).
 * La tarifa se fija en el evento — no se recalcula después (P8: auditoría total).
 */
export const zPayloadHoraPersonal = z.object({
  parteDiarioId: zUUID,
  personalParteId: zUUID,
  proyectoId: zUUID,
  partidaId: zUUID,
  nombre: z.string().min(1).max(200),
  tipo: z.enum(['PROPIO', 'SUBCONTRATADO']),
  empleadoId: zUUID.nullable(),
  horasTrabajadas: zDecimal,
  tarifaHoraria: zDecimal,
  moneda: zMoneda,
  costoTotal: zDecimal,
});

export type PayloadHoraPersonal = z.infer<typeof zPayloadHoraPersonal>;
