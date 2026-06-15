import { z } from 'zod';
import { zUUID } from '@tributia/shared';

const zDecimal = z.string().regex(/^\d+(\.\d{1,4})?$/, 'Debe ser decimal con hasta 4 decimales');

export const zPayloadEmisionOc = z.object({
  ocId: zUUID,
  totalMonto: zDecimal,
  moneda: z.enum(['DOP', 'USD', 'EUR']),
  lineas: z.array(
    z.object({
      lineaOcId: zUUID,
      partidaId: zUUID,
      insumoId: zUUID.nullable(),
      descripcion: z.string().min(1).max(500),
      cantidad: zDecimal,
      precioUnitario: zDecimal,
      total: zDecimal,
    }),
  ).min(1),
});

export type PayloadEmisionOc = z.infer<typeof zPayloadEmisionOc>;
