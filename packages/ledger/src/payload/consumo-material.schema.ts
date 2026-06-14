import { z } from 'zod';
import { zUUID, zMoney } from '@tributia/shared';

const zDecimal = z.string().regex(/^\d+(\.\d{1,4})?$/, 'Debe ser decimal con hasta 4 decimales');

export const zPayloadConsumoMaterial = z.object({
  insumoId: zUUID,
  almacenId: zUUID,
  cantidad: zDecimal,
  unidad: z.string().min(1).max(20),
  costoUnitario: zMoney,
  partidaId: zUUID.nullable(),
});

export type PayloadConsumoMaterial = z.infer<typeof zPayloadConsumoMaterial>;
