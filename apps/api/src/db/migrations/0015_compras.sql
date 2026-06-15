-- Migración 0015: Compras I — Requisición → Cotización → Orden de Compra (Sesión 5 Capa 1)
-- ─────────────────────────────────────────────────────────────────────────────
-- Implementa:
--   1. requisicion + linea_requisicion
--   2. solicitud_cotizacion (SOC) + linea_soc + soc_proveedor
--   3. cotizacion + linea_cotizacion
--   4. orden_compra + linea_orden_compra
--   5. ejecucion_partida (proyección comprometido/devengado)
--   6. RLS + GRANT en todas las tablas
--   7. Triggers audit_row + prevent_delete donde corresponde
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── 1. requisicion ───────────────────────────────────────────────────────────
CREATE TABLE requisicion (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID          NOT NULL REFERENCES tenant(id),
  empresa_id        UUID          NOT NULL REFERENCES empresa(id),
  numero            VARCHAR(30)   NOT NULL,
  proyecto_id       UUID          NOT NULL REFERENCES proyecto(id),
  estado            VARCHAR(30)   NOT NULL DEFAULT 'BORRADOR',
  solicitado_por    UUID          NOT NULL,
  fecha_requerida   DATE,
  notas             TEXT,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  UUID        NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  UUID        NOT NULL,
  deleted_at  TIMESTAMPTZ,
  deleted_by  UUID,

  CONSTRAINT req_estado_check
    CHECK (estado IN ('BORRADOR','PENDIENTE_APROBACION','APROBADA','RECHAZADA','CONSOLIDADA','CANCELADA'))
);

CREATE INDEX req_tenant_id_idx        ON requisicion(tenant_id);
CREATE INDEX req_proyecto_id_idx      ON requisicion(proyecto_id);
CREATE UNIQUE INDEX req_tenant_numero_unique ON requisicion(tenant_id, numero);

ALTER TABLE requisicion ENABLE ROW LEVEL SECURITY;
CREATE POLICY req_tenant_isolation ON requisicion
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON requisicion TO tributia_app;

CREATE TRIGGER audit_requisicion
  AFTER INSERT OR UPDATE OR DELETE ON requisicion
  FOR EACH ROW EXECUTE FUNCTION audit_row();

CREATE TRIGGER no_delete_requisicion
  BEFORE DELETE ON requisicion
  FOR EACH ROW EXECUTE FUNCTION prevent_delete();

-- ─── 2. linea_requisicion ─────────────────────────────────────────────────────
CREATE TABLE linea_requisicion (
  id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID          NOT NULL REFERENCES tenant(id),
  requisicion_id      UUID          NOT NULL REFERENCES requisicion(id),
  partida_id          UUID          NOT NULL REFERENCES partida(id),
  insumo_id           UUID          REFERENCES insumo(id),
  descripcion         VARCHAR(500)  NOT NULL,
  cantidad            NUMERIC(18,4) NOT NULL,
  unidad_medida       VARCHAR(20)   NOT NULL,
  precio_estimado     NUMERIC(18,4) NOT NULL DEFAULT 0,
  moneda              VARCHAR(3)    NOT NULL DEFAULT 'DOP',

  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  UUID        NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  UUID        NOT NULL
);

CREATE INDEX linea_req_tenant_id_idx      ON linea_requisicion(tenant_id);
CREATE INDEX linea_req_requisicion_id_idx ON linea_requisicion(requisicion_id);
CREATE INDEX linea_req_partida_id_idx     ON linea_requisicion(partida_id);

ALTER TABLE linea_requisicion ENABLE ROW LEVEL SECURITY;
CREATE POLICY linea_req_tenant_isolation ON linea_requisicion
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON linea_requisicion TO tributia_app;

CREATE TRIGGER audit_linea_requisicion
  AFTER INSERT OR UPDATE OR DELETE ON linea_requisicion
  FOR EACH ROW EXECUTE FUNCTION audit_row();

-- ─── 3. solicitud_cotizacion (SOC) ────────────────────────────────────────────
CREATE TABLE solicitud_cotizacion (
  id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID         NOT NULL REFERENCES tenant(id),
  empresa_id        UUID         NOT NULL REFERENCES empresa(id),
  numero            VARCHAR(30)  NOT NULL,
  estado            VARCHAR(20)  NOT NULL DEFAULT 'BORRADOR',
  fecha_vencimiento DATE,
  notas             TEXT,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  UUID        NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  UUID        NOT NULL,
  deleted_at  TIMESTAMPTZ,
  deleted_by  UUID,

  CONSTRAINT soc_estado_check
    CHECK (estado IN ('BORRADOR','ENVIADA','CERRADA','CANCELADA'))
);

CREATE INDEX soc_tenant_id_idx        ON solicitud_cotizacion(tenant_id);
CREATE UNIQUE INDEX soc_tenant_numero_unique ON solicitud_cotizacion(tenant_id, numero);

ALTER TABLE solicitud_cotizacion ENABLE ROW LEVEL SECURITY;
CREATE POLICY soc_tenant_isolation ON solicitud_cotizacion
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON solicitud_cotizacion TO tributia_app;

CREATE TRIGGER audit_solicitud_cotizacion
  AFTER INSERT OR UPDATE OR DELETE ON solicitud_cotizacion
  FOR EACH ROW EXECUTE FUNCTION audit_row();

CREATE TRIGGER no_delete_solicitud_cotizacion
  BEFORE DELETE ON solicitud_cotizacion
  FOR EACH ROW EXECUTE FUNCTION prevent_delete();

-- ─── 4. linea_soc ─────────────────────────────────────────────────────────────
CREATE TABLE linea_soc (
  id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID          NOT NULL REFERENCES tenant(id),
  soc_id                UUID          NOT NULL REFERENCES solicitud_cotizacion(id),
  linea_requisicion_id  UUID          NOT NULL REFERENCES linea_requisicion(id),
  cantidad              NUMERIC(18,4) NOT NULL,
  unidad_medida         VARCHAR(20)   NOT NULL,
  descripcion           VARCHAR(500)  NOT NULL,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  UUID        NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  UUID        NOT NULL
);

CREATE INDEX linea_soc_tenant_id_idx  ON linea_soc(tenant_id);
CREATE INDEX linea_soc_soc_id_idx     ON linea_soc(soc_id);
CREATE INDEX linea_soc_linea_req_idx  ON linea_soc(linea_requisicion_id);

ALTER TABLE linea_soc ENABLE ROW LEVEL SECURITY;
CREATE POLICY linea_soc_tenant_isolation ON linea_soc
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON linea_soc TO tributia_app;

CREATE TRIGGER audit_linea_soc
  AFTER INSERT OR UPDATE OR DELETE ON linea_soc
  FOR EACH ROW EXECUTE FUNCTION audit_row();

-- ─── 5. soc_proveedor ─────────────────────────────────────────────────────────
CREATE TABLE soc_proveedor (
  id          UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID  NOT NULL REFERENCES tenant(id),
  soc_id      UUID  NOT NULL REFERENCES solicitud_cotizacion(id),
  tercero_id  UUID  NOT NULL REFERENCES tercero(id),
  enviada_en  TIMESTAMPTZ,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  UUID        NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  UUID        NOT NULL,

  CONSTRAINT soc_prov_soc_tercero_unique UNIQUE (soc_id, tercero_id)
);

CREATE INDEX soc_prov_tenant_id_idx ON soc_proveedor(tenant_id);
CREATE INDEX soc_prov_soc_id_idx    ON soc_proveedor(soc_id);

ALTER TABLE soc_proveedor ENABLE ROW LEVEL SECURITY;
CREATE POLICY soc_prov_tenant_isolation ON soc_proveedor
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON soc_proveedor TO tributia_app;

CREATE TRIGGER audit_soc_proveedor
  AFTER INSERT OR UPDATE OR DELETE ON soc_proveedor
  FOR EACH ROW EXECUTE FUNCTION audit_row();

-- ─── 6. cotizacion ────────────────────────────────────────────────────────────
CREATE TABLE cotizacion (
  id                          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   UUID        NOT NULL REFERENCES tenant(id),
  soc_id                      UUID        NOT NULL REFERENCES solicitud_cotizacion(id),
  tercero_id                  UUID        NOT NULL REFERENCES tercero(id),
  numero_cotizacion_proveedor VARCHAR(50),
  fecha_emision               DATE,
  fecha_validez               DATE,
  estado                      VARCHAR(20) NOT NULL DEFAULT 'RECIBIDA',
  condiciones_pago            VARCHAR(200),
  notas                       TEXT,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  UUID        NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  UUID        NOT NULL,
  deleted_at  TIMESTAMPTZ,
  deleted_by  UUID,

  CONSTRAINT cotizacion_estado_check
    CHECK (estado IN ('RECIBIDA','EVALUADA','SELECCIONADA','RECHAZADA'))
);

CREATE INDEX cotizacion_tenant_id_idx  ON cotizacion(tenant_id);
CREATE INDEX cotizacion_soc_id_idx     ON cotizacion(soc_id);
CREATE INDEX cotizacion_tercero_id_idx ON cotizacion(tercero_id);

ALTER TABLE cotizacion ENABLE ROW LEVEL SECURITY;
CREATE POLICY cotizacion_tenant_isolation ON cotizacion
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON cotizacion TO tributia_app;

CREATE TRIGGER audit_cotizacion
  AFTER INSERT OR UPDATE OR DELETE ON cotizacion
  FOR EACH ROW EXECUTE FUNCTION audit_row();

CREATE TRIGGER no_delete_cotizacion
  BEFORE DELETE ON cotizacion
  FOR EACH ROW EXECUTE FUNCTION prevent_delete();

-- ─── 7. linea_cotizacion ──────────────────────────────────────────────────────
CREATE TABLE linea_cotizacion (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID          NOT NULL REFERENCES tenant(id),
  cotizacion_id     UUID          NOT NULL REFERENCES cotizacion(id),
  linea_soc_id      UUID          NOT NULL REFERENCES linea_soc(id),
  precio_unitario   NUMERIC(18,4) NOT NULL,
  cantidad          NUMERIC(18,4) NOT NULL,
  total             NUMERIC(18,4) NOT NULL,
  moneda            VARCHAR(3)    NOT NULL DEFAULT 'DOP',
  plazo_entrega_dias INTEGER,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  UUID        NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  UUID        NOT NULL,

  CONSTRAINT linea_cot_cotizacion_linea_soc_unique UNIQUE (cotizacion_id, linea_soc_id)
);

CREATE INDEX linea_cot_tenant_id_idx    ON linea_cotizacion(tenant_id);
CREATE INDEX linea_cot_cotizacion_id_idx ON linea_cotizacion(cotizacion_id);
CREATE INDEX linea_cot_linea_soc_id_idx ON linea_cotizacion(linea_soc_id);

ALTER TABLE linea_cotizacion ENABLE ROW LEVEL SECURITY;
CREATE POLICY linea_cot_tenant_isolation ON linea_cotizacion
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON linea_cotizacion TO tributia_app;

CREATE TRIGGER audit_linea_cotizacion
  AFTER INSERT OR UPDATE OR DELETE ON linea_cotizacion
  FOR EACH ROW EXECUTE FUNCTION audit_row();

-- ─── 8. orden_compra ──────────────────────────────────────────────────────────
CREATE TABLE orden_compra (
  id                      UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID          NOT NULL REFERENCES tenant(id),
  empresa_id              UUID          NOT NULL REFERENCES empresa(id),
  numero                  VARCHAR(30)   NOT NULL,
  estado                  VARCHAR(30)   NOT NULL DEFAULT 'BORRADOR',
  tercero_id              UUID          NOT NULL REFERENCES tercero(id),
  cotizacion_id           UUID          REFERENCES cotizacion(id),
  fecha_emision           DATE,
  fecha_entrega_prometida DATE,
  condiciones_pago        VARCHAR(200),
  total_monto             NUMERIC(18,4) NOT NULL DEFAULT 0,
  moneda                  VARCHAR(3)    NOT NULL DEFAULT 'DOP',
  notas                   TEXT,
  instancia_flujo_id      UUID,
  evento_emision_id       UUID,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  UUID        NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  UUID        NOT NULL,
  deleted_at  TIMESTAMPTZ,
  deleted_by  UUID,

  CONSTRAINT oc_estado_check
    CHECK (estado IN ('BORRADOR','PENDIENTE_APROBACION','APROBADA','RECHAZADA','EMITIDA','RECIBIDA_PARCIAL','RECIBIDA_TOTAL','CANCELADA'))
);

CREATE INDEX oc_tenant_id_idx       ON orden_compra(tenant_id);
CREATE INDEX oc_tercero_id_idx      ON orden_compra(tercero_id);
CREATE UNIQUE INDEX oc_tenant_numero_unique ON orden_compra(tenant_id, numero);

ALTER TABLE orden_compra ENABLE ROW LEVEL SECURITY;
CREATE POLICY oc_tenant_isolation ON orden_compra
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON orden_compra TO tributia_app;

CREATE TRIGGER audit_orden_compra
  AFTER INSERT OR UPDATE OR DELETE ON orden_compra
  FOR EACH ROW EXECUTE FUNCTION audit_row();

CREATE TRIGGER no_delete_orden_compra
  BEFORE DELETE ON orden_compra
  FOR EACH ROW EXECUTE FUNCTION prevent_delete();

-- ─── 9. linea_orden_compra ────────────────────────────────────────────────────
CREATE TABLE linea_orden_compra (
  id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID          NOT NULL REFERENCES tenant(id),
  orden_compra_id  UUID          NOT NULL REFERENCES orden_compra(id),
  partida_id       UUID          NOT NULL REFERENCES partida(id),
  insumo_id        UUID          REFERENCES insumo(id),
  descripcion      VARCHAR(500)  NOT NULL,
  cantidad         NUMERIC(18,4) NOT NULL,
  unidad_medida    VARCHAR(20)   NOT NULL,
  precio_unitario  NUMERIC(18,4) NOT NULL,
  total            NUMERIC(18,4) NOT NULL,
  moneda           VARCHAR(3)    NOT NULL DEFAULT 'DOP',

  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  UUID        NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  UUID        NOT NULL
);

CREATE INDEX linea_oc_tenant_id_idx      ON linea_orden_compra(tenant_id);
CREATE INDEX linea_oc_orden_compra_id_idx ON linea_orden_compra(orden_compra_id);
CREATE INDEX linea_oc_partida_id_idx     ON linea_orden_compra(partida_id);

ALTER TABLE linea_orden_compra ENABLE ROW LEVEL SECURITY;
CREATE POLICY linea_oc_tenant_isolation ON linea_orden_compra
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON linea_orden_compra TO tributia_app;

CREATE TRIGGER audit_linea_orden_compra
  AFTER INSERT OR UPDATE OR DELETE ON linea_orden_compra
  FOR EACH ROW EXECUTE FUNCTION audit_row();

-- ─── 10. ejecucion_partida (proyección comprometido/devengado) ─────────────────
CREATE TABLE ejecucion_partida (
  id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID          NOT NULL REFERENCES tenant(id),
  partida_id            UUID          NOT NULL REFERENCES partida(id),
  comprometido          NUMERIC(18,4) NOT NULL DEFAULT 0,
  devengado             NUMERIC(18,4) NOT NULL DEFAULT 0,
  moneda                VARCHAR(3)    NOT NULL DEFAULT 'DOP',
  ultima_actualizacion  TIMESTAMPTZ   NOT NULL DEFAULT now(),

  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  UUID        NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  UUID        NOT NULL,

  CONSTRAINT ep_tenant_partida_unique UNIQUE (tenant_id, partida_id)
);

CREATE INDEX ep_tenant_partida_idx ON ejecucion_partida(tenant_id, partida_id);

ALTER TABLE ejecucion_partida ENABLE ROW LEVEL SECURITY;
CREATE POLICY ep_tenant_isolation ON ejecucion_partida
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE ON ejecucion_partida TO tributia_app;
-- No DELETE: las proyecciones no se borran, se llevan a cero mediante contra-eventos

CREATE TRIGGER audit_ejecucion_partida
  AFTER INSERT OR UPDATE ON ejecucion_partida
  FOR EACH ROW EXECUTE FUNCTION audit_row();
