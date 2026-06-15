import { z } from 'zod';
import { zUUID } from '@tributia/shared';

const zDecimal = z.string().regex(/^\d+(\.\d{1,4})?$/, 'Debe ser decimal con hasta 4 decimales');
const zMoneda = z.enum(['DOP', 'USD', 'EUR']);

export const zPayloadRecepcionOc = z.object({
  ocId: zUUID,
  recepcionOcId: zUUID,
  almacenId: zUUID,
  conduce: z.string().max(50).optional(),
  archivoConduceId: zUUID.nullable(),
  lineas: z
    .array(
      z.object({
        lineaOcId: zUUID,
        insumoId: zUUID,
        partidaId: zUUID,
        cantidadRecibida: zDecimal,
        costoUnitario: zDecimal,
        moneda: zMoneda,
        observacion: z.string().max(500).optional(),
      }),
    )
    .min(1),
  totalMonto: zDecimal,
  moneda: zMoneda,
});

export type PayloadRecepcionOc = z.infer<typeof zPayloadRecepcionOc>;
