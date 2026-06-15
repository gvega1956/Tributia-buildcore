-- ─────────────────────────────────────────────────────────────────────────────
-- 0016_emision_oc_tipo_evento.sql
--
-- Agrega 'emision_oc' al catálogo cerrado de tipos de evento del ledger.
-- El compromiso se registra cuando se emite una OC aprobada (ADR-0004).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE evento_operativo
  DROP CONSTRAINT evento_tipo_evento_check;

ALTER TABLE evento_operativo
  ADD CONSTRAINT evento_tipo_evento_check CHECK (tipo_evento IN (
    'recepcion_material','consumo_material','transferencia_almacen',
    'avance_partida','hora_equipo','hora_personal',
    'recepcion_factura_proveedor','emision_factura_cliente',
    'pago_emitido','cobro_recibido','avance_subcontrato',
    'retencion_aplicada','combustible_cargado','mantenimiento_ejecutado',
    'orden_cambio_aprobada','ajuste_inventario',
    'emision_oc',
    'evento_reversa'
  ));
