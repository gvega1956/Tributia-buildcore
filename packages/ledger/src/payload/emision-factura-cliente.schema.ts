import { z } from 'zod';
import { zUUID, zMoney, zBusinessDate } from '@tributia/shared';

// El payload lleva TODOS los montos e IDs que el handler necesita para
// generar el asiento y la cuenta_por_cobrar directamente — no se consulta
// factura_cliente por evento_id dentro del handler síncrono (ese FK aún no
// está poblado en ese punto de la transacción).
export const zPayloadEmisionFacturaCliente = z.object({
  facturaClienteId: zUUID,
  cubicacionId: zUUID,
  clienteId: zUUID,
  fechaEmision: zBusinessDate,
  fechaVencimiento: zBusinessDate,
  montoSubtotal: zMoney,
  montoItbis: zMoney,
  montoRetencionIsr: zMoney,
  montoRetencionItbis: zMoney,
  montoTotal: zMoney,
  montoNetoACobrar: zMoney,
});

export type PayloadEmisionFacturaCliente = z.infer<typeof zPayloadEmisionFacturaCliente>;
