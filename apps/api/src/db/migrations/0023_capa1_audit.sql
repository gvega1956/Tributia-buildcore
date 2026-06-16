-- Migration 0023: Auditoría Capa 1 — columnas de auditoría faltantes
-- Defecto A: stock_almacen falta created_at, created_by, updated_by
-- Defecto B: cola_sincronizacion falta updated_at, updated_by

-- ─── stock_almacen ────────────────────────────────────────────────────────────
-- Proyección mutable (WAC se recalcula en cada recepción). Necesita todas las
-- columnas de auditoría para saber quién y cuándo actualizó cada posición de stock.

ALTER TABLE stock_almacen
  ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN created_by uuid NOT NULL DEFAULT '00000000-0000-7000-0000-000000000000',
  ADD COLUMN updated_by uuid NOT NULL DEFAULT '00000000-0000-7000-0000-000000000000';

COMMENT ON TABLE stock_almacen IS
  'Proyección de stock actual por (almacen, insumo). Mutable via WAC. Todas las columnas de auditoría requeridas.';

-- ─── cola_sincronizacion ──────────────────────────────────────────────────────
-- Cola de operaciones offline con transiciones de estado (PENDIENTE → PROCESADO/CONFLICTO).
-- Las actualizaciones de estado deben registrar quién y cuándo.

ALTER TABLE cola_sincronizacion
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN updated_by uuid NOT NULL DEFAULT '00000000-0000-7000-0000-000000000000';

COMMENT ON TABLE cola_sincronizacion IS
  'Cola de operaciones capturadas offline (P7). Transiciones de estado auditadas.';
