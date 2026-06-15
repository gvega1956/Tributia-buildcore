import { z } from 'zod';
import { zUUID } from '@tributia/shared';

const zDecimal = z.string().regex(/^\d+(\.\d{1,4})?$/, 'Debe ser decimal con hasta 4 decimales');

export const zPayloadTransferenciaAlmacen = z.object({
  almacenOrigenId: zUUID,
  almacenDestinoId: zUUID,
  insumoId: zUUID,
  cantidad: zDecimal,
  unidad: z.string().min(1).max(20),
});

export type PayloadTransferenciaAlmacen = z.infer<typeof zPayloadTransferenciaAlmacen>;
