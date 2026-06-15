export const TIPOS_EVENTO = [
  'recepcion_material',
  'consumo_material',
  'transferencia_almacen',
  'avance_partida',
  'hora_equipo',
  'hora_personal',
  'recepcion_factura_proveedor',
  'emision_factura_cliente',
  'pago_emitido',
  'cobro_recibido',
  'avance_subcontrato',
  'retencion_aplicada',
  'combustible_cargado',
  'mantenimiento_ejecutado',
  'orden_cambio_aprobada',
  'ajuste_inventario',
  'emision_oc',
  'recepcion_oc',
  'evento_reversa',
] as const;

export type TipoEvento = (typeof TIPOS_EVENTO)[number];
