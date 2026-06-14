-- Migración 0011: tabla proyecto — la entidad reina (§4.3 arquitectura.md / P3)
-- ─────────────────────────────────────────────────────────────────────────────
-- Implementa:
--   1. Tabla proyecto con ciclo de estados y datos geográficos
--   2. RLS con política tenant_isolation
--   3. Trigger prevent_delete (reutiliza función genérica de 0002)
--   4. Trigger audit_row (reutiliza función genérica de 0002)
--   5. FK pendiente de usuario_rol_proyecto → proyecto (creada en 0001 sin FK)
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── 1. Tabla proyecto ───────────────────────────────────────────────────────
CREATE TABLE proyecto (
  id                        UUID            PRIMARY KEY,
  tenant_id                 UUID            NOT NULL REFERENCES tenant(id),
  empresa_id                UUID            NOT NULL REFERENCES empresa(id),

  codigo                    VARCHAR(50)     NOT NULL,
  nombre                    VARCHAR(200)    NOT NULL,
  descripcion               TEXT,

  -- Ciclo de estados (máquina de estados unidireccional)
  estado                    VARCHAR(30)     NOT NULL DEFAULT 'PROSPECTO',

  tipo_obra                 VARCHAR(30)     NOT NULL,

  -- cliente_id referencia Tercero — nunca texto libre (invariante de dominio)
  cliente_id                UUID            NOT NULL REFERENCES tercero(id),

  -- Datos contractuales
  numero_contrato           VARCHAR(100),
  monto_contrato            NUMERIC(18,4),
  moneda_contrato           VARCHAR(3)      NOT NULL DEFAULT 'DOP',

  -- Fechas de obra
  fecha_inicio_planificada  DATE,
  fecha_fin_planificada     DATE,
  fecha_inicio_real         DATE,
  fecha_fin_real            DATE,

  -- Ubicación geográfica
  ubicacion_descripcion     TEXT,
  latitud                   NUMERIC(10,7),
  longitud                  NUMERIC(10,7),

  activo                    BOOLEAN         NOT NULL DEFAULT TRUE,

  -- Auditoría obligatoria (P8)
  created_at                TIMESTAMPTZ     NOT NULL DEFAULT now(),
  created_by                UUID            NOT NULL,
  updated_at                TIMESTAMPTZ     NOT NULL DEFAULT now(),
  updated_by                UUID            NOT NULL,
  deleted_at                TIMESTAMPTZ,
  deleted_by                UUID,

  CONSTRAINT proyecto_estado_check
    CHECK (estado IN ('PROSPECTO','LICITACION','ADJUDICADO','EN_EJECUCION','CIERRE','GARANTIA','CERRADO')),
  CONSTRAINT proyecto_tipo_obra_check
    CHECK (tipo_obra IN ('RESIDENCIAL','COMERCIAL','INDUSTRIAL','VIAL','HIDRAULICO','INSTITUCIONAL','MIXTO','OTRO')),
  CONSTRAINT proyecto_tenant_empresa_codigo_unique
    UNIQUE (tenant_id, empresa_id, codigo)
);

CREATE INDEX proyecto_tenant_id_idx   ON proyecto (tenant_id);
CREATE INDEX proyecto_empresa_id_idx  ON proyecto (empresa_id);
CREATE INDEX proyecto_cliente_id_idx  ON proyecto (cliente_id);
CREATE INDEX proyecto_estado_idx      ON proyecto (estado);

-- ─── 2. RLS — aislamiento por tenant ────────────────────────────────────────
ALTER TABLE proyecto ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON proyecto
  USING     (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());

-- ─── 3. prevent_delete (reutiliza función genérica de 0002) ─────────────────
-- El Proyecto nunca se elimina físicamente; se usa soft-delete (activo=false).
CREATE TRIGGER no_delete_proyecto
  BEFORE DELETE ON proyecto
  FOR EACH ROW EXECUTE FUNCTION prevent_delete();

-- ─── 4. audit_row (reutiliza función genérica de 0002) ──────────────────────
CREATE TRIGGER audit_proyecto
  AFTER INSERT OR UPDATE ON proyecto
  FOR EACH ROW EXECUTE FUNCTION audit_row();

-- ─── 5. Privilegios ─────────────────────────────────────────────────────────
-- DELETE intencional omitido: soft-delete vía deleted_at/activo.
GRANT SELECT, INSERT, UPDATE ON proyecto TO tributia_app;

-- ─── 6. FK pendiente: usuario_rol_proyecto → proyecto ───────────────────────
-- La tabla usuario_rol_proyecto fue creada en 0001 con proyecto_id UUID NOT NULL
-- sin FK (comentario: "FK a proyecto.id se añade cuando se cree la tabla proyecto").
ALTER TABLE usuario_rol_proyecto
  ADD CONSTRAINT urp_proyecto_id_fkey FOREIGN KEY (proyecto_id) REFERENCES proyecto(id);
