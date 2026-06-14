-- Migración 0002: auditoría e inmutabilidad (P8)
-- ─────────────────────────────────────────────────────────────────────────────
-- Implementa:
--   1. Tabla audit_log (sin RLS — escrita por triggers SECURITY DEFINER)
--   2. Función audit_row()  — captura quién/cuándo/desde dónde/diff en cada cambio
--   3. Función prevent_delete() — rechaza DELETE físico en tablas protegidas
--   4. Triggers en tablas sensibles de Capa 0
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── 1. Tabla audit_log ──────────────────────────────────────────────────────
CREATE TABLE audit_log (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID         REFERENCES tenant(id),        -- nullable: tenant table no tiene tenant_id
  tabla_nombre     VARCHAR(100) NOT NULL,
  registro_id      UUID         NOT NULL,
  operacion        VARCHAR(10)  NOT NULL,
  usuario_id       UUID,                                       -- de app.current_user_id
  ip_address       VARCHAR(45),                                -- IPv4 o IPv6
  user_agent       TEXT,
  datos_anteriores JSONB,
  datos_nuevos     JSONB,
  diff             JSONB,                                      -- solo campos que cambiaron
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),

  CONSTRAINT audit_log_operacion_check CHECK (operacion IN ('INSERT', 'UPDATE', 'DELETE'))
);

-- Índices para consultas frecuentes de auditoría
CREATE INDEX audit_log_tenant_id_idx       ON audit_log(tenant_id);
CREATE INDEX audit_log_tabla_registro_idx  ON audit_log(tabla_nombre, registro_id);
CREATE INDEX audit_log_usuario_id_idx      ON audit_log(usuario_id);
CREATE INDEX audit_log_created_at_idx      ON audit_log(created_at DESC);

-- tributia_app puede CONSULTAR la bitácora, no escribirla ni borrarla.
-- Las escrituras las hace el trigger SECURITY DEFINER (como el owner).
GRANT SELECT ON audit_log TO tributia_app;

-- ─── 2. Función audit_row() ──────────────────────────────────────────────────
-- SECURITY DEFINER: se ejecuta con los privilegios del owner (tributia),
-- no del usuario de sesión (tributia_app). Esto permite escribir en audit_log
-- incluso desde transacciones que solo tienen permisos de aplicación.
-- SET search_path = public: hardcodeado para evitar ataques de search_path injection.
CREATE OR REPLACE FUNCTION audit_row()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old       JSONB;
  v_new       JSONB;
  v_diff      JSONB;
  v_user_id   UUID;
  v_ip        TEXT;
  v_agent     TEXT;
  v_tenant_id UUID;
  v_reg_id    UUID;
  v_raw_user  TEXT;
  v_raw_tenant TEXT;
BEGIN
  -- Leer variables de sesión (silenciosas si no están seteadas)
  v_raw_user   := nullif(trim(current_setting('app.current_user_id', true)), '');
  v_raw_tenant := nullif(trim(current_setting('app.tenant_id',        true)), '');
  v_ip         := nullif(trim(current_setting('app.client_ip',        true)), '');
  v_agent      := nullif(trim(current_setting('app.user_agent',       true)), '');

  -- Cast seguro: si el valor no es UUID válido se ignora (puede pasar en seeds)
  BEGIN
    v_user_id := v_raw_user::UUID;
  EXCEPTION WHEN invalid_text_representation THEN
    v_user_id := NULL;
  END;

  BEGIN
    v_tenant_id := v_raw_tenant::UUID;
  EXCEPTION WHEN invalid_text_representation THEN
    v_tenant_id := NULL;
  END;

  -- Construir el diff: solo los campos que cambiaron
  IF TG_OP = 'INSERT' THEN
    v_new       := to_jsonb(NEW);
    v_reg_id    := (v_new->>'id')::UUID;
    -- Si la fila tiene tenant_id, usarlo (puede sobreescribir la var de sesión)
    IF v_new ? 'tenant_id' AND v_new->>'tenant_id' IS NOT NULL THEN
      v_tenant_id := (v_new->>'tenant_id')::UUID;
    END IF;

  ELSIF TG_OP = 'UPDATE' THEN
    v_old  := to_jsonb(OLD);
    v_new  := to_jsonb(NEW);
    v_reg_id := (v_new->>'id')::UUID;
    IF v_new ? 'tenant_id' AND v_new->>'tenant_id' IS NOT NULL THEN
      v_tenant_id := (v_new->>'tenant_id')::UUID;
    END IF;
    -- diff: claves cuyo valor difiere entre OLD y NEW
    SELECT jsonb_object_agg(n.key, n.value)
    INTO   v_diff
    FROM   jsonb_each(v_new) AS n(key, value)
    WHERE  n.value IS DISTINCT FROM v_old->n.key;

  ELSIF TG_OP = 'DELETE' THEN
    v_old    := to_jsonb(OLD);
    v_reg_id := (v_old->>'id')::UUID;
    IF v_old ? 'tenant_id' AND v_old->>'tenant_id' IS NOT NULL THEN
      v_tenant_id := (v_old->>'tenant_id')::UUID;
    END IF;
  END IF;

  INSERT INTO audit_log (
    id,
    tenant_id,
    tabla_nombre,
    registro_id,
    operacion,
    usuario_id,
    ip_address,
    user_agent,
    datos_anteriores,
    datos_nuevos,
    diff
  ) VALUES (
    gen_random_uuid(),
    v_tenant_id,
    TG_TABLE_NAME,
    v_reg_id,
    TG_OP,
    v_user_id,
    v_ip,
    v_agent,
    v_old,
    v_new,
    v_diff
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

-- ─── 3. Función prevent_delete() ─────────────────────────────────────────────
-- Rechaza cualquier DELETE físico. El mensaje indica cómo proceder.
CREATE OR REPLACE FUNCTION prevent_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'Borrado físico no permitido en tabla "%". Use soft-delete (columna activo = false o deleted_at).',
    TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$;

-- ─── 4. Triggers en tablas sensibles ────────────────────────────────────────
-- Convención de nombres:
--   audit_<tabla>        — bitácora de cambios (AFTER)
--   no_delete_<tabla>    — bloqueo de DELETE físico (BEFORE)
--
-- Tablas auditadas en Capa 0:
--   tenant, empresa, sucursal, centro_costo, usuario, rol, usuario_rol_empresa
--
-- Tablas protegidas contra DELETE físico (soft-delete obligatorio):
--   tenant, empresa, sucursal, centro_costo, usuario, rol

-- ── tenant ───────────────────────────────────────────────────────────────────
CREATE TRIGGER audit_tenant
  AFTER INSERT OR UPDATE OR DELETE ON tenant
  FOR EACH ROW EXECUTE FUNCTION audit_row();

CREATE TRIGGER no_delete_tenant
  BEFORE DELETE ON tenant
  FOR EACH ROW EXECUTE FUNCTION prevent_delete();

-- ── empresa ───────────────────────────────────────────────────────────────────
CREATE TRIGGER audit_empresa
  AFTER INSERT OR UPDATE OR DELETE ON empresa
  FOR EACH ROW EXECUTE FUNCTION audit_row();

CREATE TRIGGER no_delete_empresa
  BEFORE DELETE ON empresa
  FOR EACH ROW EXECUTE FUNCTION prevent_delete();

-- ── sucursal ─────────────────────────────────────────────────────────────────
CREATE TRIGGER audit_sucursal
  AFTER INSERT OR UPDATE OR DELETE ON sucursal
  FOR EACH ROW EXECUTE FUNCTION audit_row();

CREATE TRIGGER no_delete_sucursal
  BEFORE DELETE ON sucursal
  FOR EACH ROW EXECUTE FUNCTION prevent_delete();

-- ── centro_costo ─────────────────────────────────────────────────────────────
CREATE TRIGGER audit_centro_costo
  AFTER INSERT OR UPDATE OR DELETE ON centro_costo
  FOR EACH ROW EXECUTE FUNCTION audit_row();

CREATE TRIGGER no_delete_centro_costo
  BEFORE DELETE ON centro_costo
  FOR EACH ROW EXECUTE FUNCTION prevent_delete();

-- ── usuario ───────────────────────────────────────────────────────────────────
CREATE TRIGGER audit_usuario
  AFTER INSERT OR UPDATE OR DELETE ON usuario
  FOR EACH ROW EXECUTE FUNCTION audit_row();

CREATE TRIGGER no_delete_usuario
  BEFORE DELETE ON usuario
  FOR EACH ROW EXECUTE FUNCTION prevent_delete();

-- ── rol ───────────────────────────────────────────────────────────────────────
CREATE TRIGGER audit_rol
  AFTER INSERT OR UPDATE OR DELETE ON rol
  FOR EACH ROW EXECUTE FUNCTION audit_row();

CREATE TRIGGER no_delete_rol
  BEFORE DELETE ON rol
  FOR EACH ROW EXECUTE FUNCTION prevent_delete();

-- ── usuario_rol_empresa ───────────────────────────────────────────────────────
-- Auditado (cambios de permisos son sensibles) pero permite DELETE físico
-- (revocar un rol es una operación legítima, se registra en audit_log).
CREATE TRIGGER audit_usuario_rol_empresa
  AFTER INSERT OR UPDATE OR DELETE ON usuario_rol_empresa
  FOR EACH ROW EXECUTE FUNCTION audit_row();
