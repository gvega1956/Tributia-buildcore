import { z } from 'zod';
import { zUUID, zMoney, zBusinessDate } from '@tributia/shared';

// Trazabilidad pura (P2/P8) — NO genera asiento contable: el asiento ya nació
// en emision_factura_cliente (ADR-0007 §7). Exento por diseño, igual que
// emision_oc/avance_partida/transferencia_almacen/orden_cambio_aprobada (ADR-0005).
export const zPayloadEmisionEcf = z.object({
  comprobanteEcfId: zUUID,
  tipoEcf: z.enum(['E31', 'E32', 'E33', 'E34']),
  ncf: z.string().min(11).max(19),
  facturaClienteId: zUUID.optional(),
  comprobanteOrigenId: zUUID.optional(),
  fechaEmision: zBusinessDate,
  montoTotal: zMoney,
  estado: z.enum(['ACEPTADO', 'RECHAZADO', 'CONTINGENCIA']),
});

export type PayloadEmisionEcf = z.infer<typeof zPayloadEmisionEcf>;
