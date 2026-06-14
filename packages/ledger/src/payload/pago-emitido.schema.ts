import { z } from 'zod';
import { zUUID, zMoney } from '@tributia/shared';

export const zPayloadPagoEmitido = z.object({
  cuentaBancariaId: zUUID,
  monto: zMoney,
  concepto: z.string().min(1).max(500),
  cuentasPorPagarIds: z.array(zUUID).min(1),
  referenciaBancaria: z.string().max(100).nullable(),
});

export type PayloadPagoEmitido = z.infer<typeof zPayloadPagoEmitido>;
