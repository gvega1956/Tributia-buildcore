import { z } from 'zod';
import { zUUID, zMoney } from '@tributia/shared';

export const zPayloadRecepcionFacturaProveedor = z.object({
  proveedorId: zUUID,
  ncf: z.string().min(1).max(19),
  montoSubtotal: zMoney,
  montoItbis: zMoney,
  montoTotal: zMoney,
  ordenCompraId: zUUID.nullable(),
  recepcionMaterialEventoId: zUUID.nullable(),
});

export type PayloadRecepcionFacturaProveedor = z.infer<typeof zPayloadRecepcionFacturaProveedor>;
