import { z } from 'zod';
import { zUUID, zMoney } from '@tributia/shared';

/** Aplicación de un cobro a una CxC puntual — permite saldos parciales y cobros multi-factura. */
export const zAplicacionCobro = z.object({
  cuentaPorCobrarId: zUUID,
  monto: zMoney,
});

export const zPayloadCobroRecibido = z.object({
  cuentaBancariaId: zUUID,
  facturaClienteId: zUUID.nullable(),
  montoCobrado: zMoney,
  tasaFactura: z.string().regex(/^\d+(\.\d{1,6})?$/, 'Tasa con hasta 6 decimales'),
  tasaCobro: z.string().regex(/^\d+(\.\d{1,6})?$/, 'Tasa con hasta 6 decimales'),
  monedaBase: z.enum(['DOP', 'USD', 'EUR']),
  aplicaciones: z.array(zAplicacionCobro).default([]),
  referenciaBancaria: z.string().max(100).nullable().default(null),
});

export type PayloadCobroRecibido = z.infer<typeof zPayloadCobroRecibido>;
