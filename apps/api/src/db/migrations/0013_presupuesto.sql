-- Migración 0013: Motor de Presupuesto y APU (Sesión 3 Capa 1)
-- ─────────────────────────────────────────────────────────────────────────────
-- Implementa:
--   1. Tabla apu (biblioteca reutilizable + APU de partida)
--   2. Tabla apu_linea (MATERIAL, MANO_OBRA, EQUIPO, SUBCONTRATO)
--   3. Tabla version_presupuesto (BORRADOR / BASE; estado PENDIENTE/APROBADO/RECHAZADO)
--   4. Tabla linea_presupuesto (cantidad × precio por partida en cada versión)
--   5. RLS en las cuatro tablas
--   6. Triggers: audit_row, prevent_delete, protect_lineas_aprobadas (inmutabilidad)
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── 1. Tabla apu ─────────────────────────────────────────────────────────────
CREATE TABLE apu (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID          NOT NULL REFERENCES tenant(id),
  partida_id        UUID          REFERENCES partida(id),
  es_biblioteca     BOOLEAN       NOT NULL DEFAULT false,
  codigo            VARCHAR(50)   NOT NULL,
  nombre            VARCHAR(200)  NOT NULL,
  descripcion       TEXT,
  version           INTEGER       NOT NULL DEFAULT 1,
  unidad_medida_id  UUID          REFERENCES unidad_medida(id),
  precio_unitario   NUMERIC(18,4) NOT NULL DEFAULT 0,
  moneda            VARCHAR(3)    NOT NULL DEFAULT 'DOP',
  activo            BOOLEAN       NOT NULL DEFAULT true,

  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by   UUID        NOT NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by   UUID        NOT NULL,
  deleted_at   TIMESTAMPTZ,
  deleted_by   UUID
);

-- Índices
CREATE INDEX apu_tenant_id_idx  ON apu(tenant_id);
CREATE INDEX apu_partida_id_idx ON apu(partida_id);

-- Partial unique: un solo APU activo por partida
CREATE UNIQUE INDEX apu_partida_unique
  ON apu(partida_id)
  WHERE partida_id IS NOT NULL AND deleted_at IS NULL;

-- Partial unique: código + versión únicos por tenant en biblioteca
CREATE UNIQUE INDEX apu_biblioteca_codigo_version_unique
  ON apu(tenant_id, codigo, version)
  WHERE es_biblioteca = true;

-- RLS
ALTER TABLE apu ENABLE ROW LEVEL SECURITY;
CREATE POLICY apu_tenant_isolation ON apu
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON apu TO tributia_app;

-- Triggers
CREATE TRIGGER audit_apu
  AFTER INSERT OR UPDATE OR DELETE ON apu
  FOR EACH ROW EXECUTE FUNCTION audit_row();

CREATE TRIGGER no_delete_apu
  BEFORE DELETE ON apu
  FOR EACH ROW EXECUTE FUNCTION prevent_delete();

-- ─── 2. Tabla apu_linea ────────────────────────────────────────────────────────
CREATE TABLE apu_linea (
  id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID          NOT NULL REFERENCES tenant(id),
  apu_id              UUID          NOT NULL REFERENCES apu(id),
  tipo                VARCHAR(30)   NOT NULL,
  insumo_id           UUID          REFERENCES insumo(id),
  equipo_catalogo_id  UUID          REFERENCES equipo_catalogo(id),
  descripcion         VARCHAR(500),
  cantidad            NUMERIC(18,4) NOT NULL,
  precio_unitario     NUMERIC(18,4) NOT NULL,
  precio_total        NUMERIC(18,4) NOT NULL,
  moneda              VARCHAR(3)    NOT NULL DEFAULT 'DOP',
  orden               INTEGER       NOT NULL DEFAULT 1,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  UUID        NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  UUID        NOT NULL,

  CONSTRAINT apu_linea_tipo_check
    CHECK (tipo IN ('MATERIAL','MANO_OBRA','EQUIPO','SUBCONTRATO'))
);

CREATE INDEX apu_linea_apu_id_idx ON apu_linea(apu_id);

ALTER TABLE apu_linea ENABLE ROW LEVEL SECURITY;
CREATE POLICY apu_linea_tenant_isolation ON apu_linea
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON apu_linea TO tributia_app;

CREATE TRIGGER audit_apu_linea
  AFTER INSERT OR UPDATE OR DELETE ON apu_linea
  FOR EACH ROW EXECUTE FUNCTION audit_row();

-- ─── 3. Tabla version_presupuesto ──────────────────────────────────────────────
CREATE TABLE version_presupuesto (
  id                 UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID          NOT NULL REFERENCES tenant(id),
  proyecto_id        UUID          NOT NULL REFERENCES proyecto(id),
  nombre             VARCHAR(200)  NOT NULL,
  tipo               VARCHAR(20)   NOT NULL DEFAULT 'BORRADOR',
  estado             VARCHAR(20)   NOT NULL DEFAULT 'PENDIENTE',
  notas              TEXT,
  moneda             VARCHAR(3)    NOT NULL DEFAULT 'DOP',
  total_directo      NUMERIC(18,4) NOT NULL DEFAULT 0,
  total_indirecto    NUMERIC(18,4) NOT NULL DEFAULT 0,
  total_presupuesto  NUMERIC(18,4) NOT NULL DEFAULT 0,
  aprobado_por       UUID,
  aprobado_en        TIMESTAMPTZ,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  UUID        NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  UUID        NOT NULL,
  deleted_at  TIMESTAMPTZ,
  deleted_by  UUID,

  CONSTRAINT vp_tipo_check
    CHECK (tipo IN ('BORRADOR','BASE')),
  CONSTRAINT vp_estado_check
    CHECK (estado IN ('PENDIENTE','APROBADO','RECHAZADO'))
);

CREATE INDEX vp_tenant_id_idx  ON version_presupuesto(tenant_id);
CREATE INDEX vp_proyecto_id_idx ON version_presupuesto(proyecto_id);

-- Solo un BASE aprobado activo por proyecto
CREATE UNIQUE INDEX vp_base_aprobado_unique
  ON version_presupuesto(proyecto_id)
  WHERE tipo = 'BASE' AND estado = 'APROBADO' AND deleted_at IS NULL;

ALTER TABLE version_presupuesto ENABLE ROW LEVEL SECURITY;
CREATE POLICY vp_tenant_isolation ON version_presupuesto
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON version_presupuesto TO tributia_app;

CREATE TRIGGER audit_version_presupuesto
  AFTER INSERT OR UPDATE OR DELETE ON version_presupuesto
  FOR EACH ROW EXECUTE FUNCTION audit_row();

CREATE TRIGGER no_delete_version_presupuesto
  BEFORE DELETE ON version_presupuesto
  FOR EACH ROW EXECUTE FUNCTION prevent_delete();

-- ─── 4. Tabla linea_presupuesto ────────────────────────────────────────────────
CREATE TABLE linea_presupuesto (
  id                      UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID          NOT NULL REFERENCES tenant(id),
  version_presupuesto_id  UUID          NOT NULL REFERENCES version_presupuesto(id),
  partida_id              UUID          NOT NULL REFERENCES partida(id),
  apu_id                  UUID          REFERENCES apu(id),
  cantidad                NUMERIC(18,4) NOT NULL,
  precio_unitario         NUMERIC(18,4) NOT NULL,
  total                   NUMERIC(18,4) NOT NULL,
  moneda                  VARCHAR(3)    NOT NULL DEFAULT 'DOP',
  es_indirecto            BOOLEAN       NOT NULL DEFAULT false,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  UUID        NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  UUID        NOT NULL,

  CONSTRAINT lp_version_partida_unique
    UNIQUE (version_presupuesto_id, partida_id)
);

CREATE INDEX lp_version_presupuesto_id_idx ON linea_presupuesto(version_presupuesto_id);
CREATE INDEX lp_partida_id_idx             ON linea_presupuesto(partida_id);

ALTER TABLE linea_presupuesto ENABLE ROW LEVEL SECURITY;
CREATE POLICY lp_tenant_isolation ON linea_presupuesto
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON linea_presupuesto TO tributia_app;

CREATE TRIGGER audit_linea_presupuesto
  AFTER INSERT OR UPDATE OR DELETE ON linea_presupuesto
  FOR EACH ROW EXECUTE FUNCTION audit_row();

-- ─── 5. Trigger de inmutabilidad: lineas de presupuesto aprobado ──────────────
--
-- Protege las lineas_presupuesto de versiones con estado='APROBADO'.
-- Toda actualización o borrado en ese estado se rechaza con excepción.
-- INSERT también se bloquea (no se pueden añadir líneas a un presupuesto aprobado).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION protect_lineas_aprobadas()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_estado VARCHAR(20);
BEGIN
  SELECT estado INTO v_estado
  FROM version_presupuesto
  WHERE id = COALESCE(NEW.version_presupuesto_id, OLD.version_presupuesto_id);

  IF v_estado = 'APROBADO' THEN
    RAISE EXCEPTION
      'El presupuesto está aprobado y es inmutable. Crea una nueva versión para modificar.';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER protect_lineas_aprobadas
  BEFORE INSERT OR UPDATE OR DELETE ON linea_presupuesto
  FOR EACH ROW EXECUTE FUNCTION protect_lineas_aprobadas();
