import { z } from 'zod';
import { zUUID, zMoney } from '@tributia/shared';

export const zPayloadReposicionCajaChica = z.object({
  fondoId: zUUID,
  reposicionId: zUUID,
  cuentaBancariaOrigenId: zUUID,
  monto: zMoney,
  instanciaFlujoId: zUUID,
});

export type PayloadReposicionCajaChica = z.infer<typeof zPayloadReposicionCajaChica>;
