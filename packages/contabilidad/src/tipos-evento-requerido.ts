/**
 * Tipos de evento operativo que REQUIEREN una regla contable configurada.
 *
 * Si la empresa no tiene la regla activa, el evento NO puede procesarse en
 * silencio: el handler debe fallar de forma visible (excepción) para que
 * el operador configure la regla antes de continuar.
 *
 * Tipos OPCIONALES (exentos por diseño — ADR-0005):
 *   - emision_oc            → solo mueve comprometido, no genera gasto
 *   - avance_partida        → es físico, no financiero
 *   - transferencia_almacen → movimiento interno sin costo
 *   - orden_cambio_aprobada → ajusta presupuesto, asiento en factura posterior
 */
export const TIPOS_EVENTO_CONTABLE_REQUERIDO: ReadonlySet<string> = new Set([
  'hora_personal',
  'hora_equipo',
  'recepcion_factura_proveedor',
  'emision_factura_cliente',
]);
