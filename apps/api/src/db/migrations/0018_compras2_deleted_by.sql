-- 0018_compras2_deleted_by.sql
-- Agrega columna deleted_by faltante en tablas de Compras II
-- (softDeleteColumns en el schema TS incluye ambas: deleted_at y deleted_by,
-- pero la migración 0017 solo creó deleted_at para estas tablas)

ALTER TABLE recepcion_oc     ADD COLUMN IF NOT EXISTS deleted_by UUID;
ALTER TABLE factura_proveedor ADD COLUMN IF NOT EXISTS deleted_by UUID;
