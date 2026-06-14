-- Migración 0009: Cierre de Capa 0 — columnas de auditoría faltantes
-- ─────────────────────────────────────────────────────────────────────────────
-- Corrección de tres tablas que carecían de las columnas de auditoría exigidas
-- por el principio P8 (Nada se borra; toda tabla tiene created_at, created_by,
-- updated_at, updated_by):
--
--   · rol_permiso        — faltaban las 4 columnas de auditoría
--   · insumo_equivalencia — faltaban las 4 columnas de auditoría
--   · refresh_token      — faltaban updated_at y updated_by
--
-- Estrategia:
--   1. ALTER TABLE … ADD COLUMN con DEFAULT temporal para satisfacer NOT NULL en
--      filas existentes (se usa SYSTEM_USER_ID = 00000000-0000-7000-0000-000000000000).
--   2. DROP DEFAULT en created_by / updated_by para que futuras inserciones
--      requieran el valor explícito (comportamiento igual al resto del esquema).
--   3. Crear trigger set_updated_at en cada tabla nueva.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── 1. rol_permiso ───────────────────────────────────────────────────────────

ALTER TABLE rol_permiso
  ADD COLUMN created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  ADD COLUMN created_by  UUID         NOT NULL DEFAULT '00000000-0000-7000-0000-000000000000',
  ADD COLUMN updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  ADD COLUMN updated_by  UUID         NOT NULL DEFAULT '00000000-0000-7000-0000-000000000000';

ALTER TABLE rol_permiso
  ALTER COLUMN created_by DROP DEFAULT,
  ALTER COLUMN updated_by DROP DEFAULT;

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON rol_permiso
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── 2. insumo_equivalencia ───────────────────────────────────────────────────

ALTER TABLE insumo_equivalencia
  ADD COLUMN created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  ADD COLUMN created_by  UUID         NOT NULL DEFAULT '00000000-0000-7000-0000-000000000000',
  ADD COLUMN updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  ADD COLUMN updated_by  UUID         NOT NULL DEFAULT '00000000-0000-7000-0000-000000000000';

ALTER TABLE insumo_equivalencia
  ALTER COLUMN created_by DROP DEFAULT,
  ALTER COLUMN updated_by DROP DEFAULT;

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON insumo_equivalencia
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── 3. refresh_token ─────────────────────────────────────────────────────────

ALTER TABLE refresh_token
  ADD COLUMN updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  ADD COLUMN updated_by  UUID         NOT NULL DEFAULT '00000000-0000-7000-0000-000000000000';

ALTER TABLE refresh_token
  ALTER COLUMN updated_by DROP DEFAULT;

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON refresh_token
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
