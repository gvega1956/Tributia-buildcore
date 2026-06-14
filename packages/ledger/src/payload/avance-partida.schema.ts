import { z } from 'zod';
import { zUUID } from '@tributia/shared';

const zDecimal = z.string().regex(/^\d+(\.\d{1,4})?$/, 'Debe ser decimal con hasta 4 decimales');

export const zPayloadAvancePartida = z.object({
  partidaId: zUUID,
  cantidadEjecutada: zDecimal,
  unidad: z.string().min(1).max(20),
  porcentajeAcumulado: z.number().min(0).max(100),
});

export type PayloadAvancePartida = z.infer<typeof zPayloadAvancePartida>;
