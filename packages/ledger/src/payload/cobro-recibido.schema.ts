import { z } from 'zod';
import { zUUID, zMoney } from '@tributia/shared';

export const zPayloadCobroRecibido = z.object({
  facturaClienteId: zUUID.nullable(),
  montoCobrado: zMoney,
  tasaFactura: z.string().regex(/^\d+(\.\d{1,6})?$/, 'Tasa con hasta 6 decimales'),
  tasaCobro: z.string().regex(/^\d+(\.\d{1,6})?$/, 'Tasa con hasta 6 decimales'),
  monedaBase: z.enum(['DOP', 'USD', 'EUR']),
});

export type PayloadCobroRecibido = z.infer<typeof zPayloadCobroRecibido>;
