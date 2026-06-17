import { z } from 'zod';
import { zUUID, zMoney } from '@tributia/shared';

export const TIPOS_COMPROBANTE_GASTO_CAJA_CHICA = ['FACTURA', 'RECIBO', 'NCF', 'OTRO'] as const;

export const zPayloadGastoCajaChica = z.object({
  fondoId: zUUID,
  monto: zMoney,
  concepto: z.string().min(1).max(500),
  numeroComprobante: z.string().min(1).max(50),
  tipoComprobante: z.enum(TIPOS_COMPROBANTE_GASTO_CAJA_CHICA),
  proveedorTerceroId: zUUID.nullable(),
  partidaId: zUUID.nullable(),
});

export type PayloadGastoCajaChica = z.infer<typeof zPayloadGastoCajaChica>;
