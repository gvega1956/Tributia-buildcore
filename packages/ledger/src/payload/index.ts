import type { z } from 'zod';
import { zPayloadRecepcionMaterial } from './recepcion-material.schema.js';
import { zPayloadConsumoMaterial } from './consumo-material.schema.js';
import { zPayloadAvancePartida } from './avance-partida.schema.js';
import { zPayloadRecepcionFacturaProveedor } from './recepcion-factura-proveedor.schema.js';
import { zPayloadPagoEmitido } from './pago-emitido.schema.js';

export * from './recepcion-material.schema.js';
export * from './consumo-material.schema.js';
export * from './avance-partida.schema.js';
export * from './recepcion-factura-proveedor.schema.js';
export * from './pago-emitido.schema.js';

/**
 * Registro de schemas de payload por tipo_evento.
 * Solo los 5 tipos definidos en Sesión 5. Los demás pasan por zEventoBase
 * con payload genérico hasta que se definan sus schemas específicos.
 */
export const PAYLOAD_SCHEMAS = {
  recepcion_material: zPayloadRecepcionMaterial,
  consumo_material: zPayloadConsumoMaterial,
  avance_partida: zPayloadAvancePartida,
  recepcion_factura_proveedor: zPayloadRecepcionFacturaProveedor,
  pago_emitido: zPayloadPagoEmitido,
} as const satisfies Record<string, z.ZodTypeAny>;

export type TipoEventoConSchema = keyof typeof PAYLOAD_SCHEMAS;
