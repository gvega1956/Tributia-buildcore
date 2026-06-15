import type { z } from 'zod';
import { zPayloadRecepcionMaterial } from './recepcion-material.schema.js';
import { zPayloadConsumoMaterial } from './consumo-material.schema.js';
import { zPayloadAvancePartida } from './avance-partida.schema.js';
import { zPayloadRecepcionFacturaProveedor } from './recepcion-factura-proveedor.schema.js';
import { zPayloadPagoEmitido } from './pago-emitido.schema.js';
import { zPayloadTransferenciaAlmacen } from './transferencia-almacen.schema.js';
import { zPayloadAjusteInventario } from './ajuste-inventario.schema.js';
import { zPayloadEmisionOc } from './emision-oc.schema.js';
import { zPayloadRecepcionOc } from './recepcion-oc.schema.js';

export * from './recepcion-material.schema.js';
export * from './consumo-material.schema.js';
export * from './avance-partida.schema.js';
export * from './recepcion-factura-proveedor.schema.js';
export * from './pago-emitido.schema.js';
export * from './transferencia-almacen.schema.js';
export * from './ajuste-inventario.schema.js';
export * from './emision-oc.schema.js';
export * from './recepcion-oc.schema.js';

export const PAYLOAD_SCHEMAS = {
  recepcion_material: zPayloadRecepcionMaterial,
  consumo_material: zPayloadConsumoMaterial,
  avance_partida: zPayloadAvancePartida,
  recepcion_factura_proveedor: zPayloadRecepcionFacturaProveedor,
  pago_emitido: zPayloadPagoEmitido,
  transferencia_almacen: zPayloadTransferenciaAlmacen,
  ajuste_inventario: zPayloadAjusteInventario,
  emision_oc: zPayloadEmisionOc,
  recepcion_oc: zPayloadRecepcionOc,
} as const satisfies Record<string, z.ZodTypeAny>;

export type TipoEventoConSchema = keyof typeof PAYLOAD_SCHEMAS;
