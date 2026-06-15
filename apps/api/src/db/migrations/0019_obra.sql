-- ─────────────────────────────────────────────────────────────────────────────
-- 0019_obra.sql — Gestión de Obra: Parte Diario, Avance Físico, RFI, Punch List
--
--   1. ALTER ejecucion_partida: añade avance_cantidad
--   2. parte_diario
--   3. personal_parte
--   4. equipo_parte
--   5. avance_obra
--   6. foto_parte
--   7. rfi
--   8. punch_list_item
--   9. RLS + GRANT + audit_row + prevent_delete donde aplica
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── 1. avance_cantidad en ejecucion_partida ──────────────────────────────────
-- Proyección del avance físico acumulado por partida (en unidades de cantidad,
-- no en porcentaje). El % se calcula en vivo: avance_cantidad / cantidad_presupuestada.
ALTER TABLE ejecucion_partida
  ADD COLUMN IF NOT EXISTS avance_cantidad NUMERIC(18,4) NOT NULL DEFAULT 0;

-- ─── 2. parte_diario ──────────────────────────────────────────────────────────
CREATE TABLE parte_diario (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID          NOT NULL REFERENCES tenant(id),
  empresa_id        UUID          NOT NULL REFERENCES empresa(id),
  proyecto_id       UUID          NOT NULL REFERENCES proyecto(id),
  fecha             DATE          NOT NULL,
  clima             VARCHAR(30)   CHECK (clima IN ('SOLEADO','NUBLADO','PARCIALMENTE_NUBLADO','LLUVIOSO','TORMENTA')),
  temperatura_c     NUMERIC(5,2),
  estado            VARCHAR(20)   NOT NULL DEFAULT 'BORRADOR'
    CHECK (estado IN ('BORRADOR','CONFIRMADO')),
  notas             TEXT,
  idempotency_key   VARCHAR(100)  NOT NULL,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
  created_by        UUID          NOT NULL,
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_by        UUID          NOT NULL,
  deleted_at        TIMESTAMPTZ,
  deleted_by        UUID,
  CONSTRAINT parte_diario_tenant_key_unique UNIQUE (tenant_id, idempotency_key)
);

CREATE INDEX parte_diario_tenant_idx   ON parte_diario(tenant_id);
CREATE INDEX parte_diario_proyecto_idx ON parte_diario(proyecto_id);
CREATE INDEX parte_diario_fecha_idx    ON parte_diario(tenant_id, proyecto_id, fecha);

ALTER TABLE parte_diario ENABLE ROW LEVEL SECURITY;
CREATE POLICY parte_diario_tenant_isolation ON parte_diario
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE ON parte_diario TO tributia_app;

CREATE TRIGGER audit_parte_diario
  AFTER INSERT OR UPDATE ON parte_diario
  FOR EACH ROW EXECUTE FUNCTION audit_row();

-- ─── 3. personal_parte ────────────────────────────────────────────────────────
CREATE TABLE personal_parte (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID          NOT NULL REFERENCES tenant(id),
  parte_id          UUID          NOT NULL REFERENCES parte_diario(id),
  nombre            VARCHAR(200)  NOT NULL,
  empleado_id       UUID,
  tipo              VARCHAR(20)   NOT NULL DEFAULT 'PROPIO'
    CHECK (tipo IN ('PROPIO','SUBCONTRATADO')),
  horas_trabajadas  NUMERIC(5,2)  NOT NULL,
  partida_id        UUID          NOT NULL REFERENCES partida(id),
  tarifa_horaria    NUMERIC(18,4) NOT NULL,
  moneda            VARCHAR(3)    NOT NULL DEFAULT 'DOP',
  costo_total       NUMERIC(18,4) NOT NULL,
  evento_id         UUID,
  idempotency_key   VARCHAR(100)  NOT NULL,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
  created_by        UUID          NOT NULL,
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_by        UUID          NOT NULL,
  CONSTRAINT personal_parte_tenant_key_unique UNIQUE (tenant_id, idempotency_key)
);

CREATE INDEX personal_parte_tenant_idx  ON personal_parte(tenant_id);
CREATE INDEX personal_parte_parte_idx   ON personal_parte(parte_id);
CREATE INDEX personal_parte_partida_idx ON personal_parte(tenant_id, partida_id);

ALTER TABLE personal_parte ENABLE ROW LEVEL SECURITY;
CREATE POLICY personal_parte_tenant_isolation ON personal_parte
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE ON personal_parte TO tributia_app;

CREATE TRIGGER audit_personal_parte
  AFTER INSERT OR UPDATE ON personal_parte
  FOR EACH ROW EXECUTE FUNCTION audit_row();

-- ─── 4. equipo_parte ──────────────────────────────────────────────────────────
CREATE TABLE equipo_parte (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID          NOT NULL REFERENCES tenant(id),
  parte_id          UUID          NOT NULL REFERENCES parte_diario(id),
  equipo_id         UUID          NOT NULL REFERENCES equipo_catalogo(id),
  horas_operadas    NUMERIC(5,2)  NOT NULL,
  partida_id        UUID          NOT NULL REFERENCES partida(id),
  tarifa_horaria    NUMERIC(18,4) NOT NULL,
  moneda            VARCHAR(3)    NOT NULL DEFAULT 'DOP',
  costo_total       NUMERIC(18,4) NOT NULL,
  observaciones     TEXT,
  evento_id         UUID,
  idempotency_key   VARCHAR(100)  NOT NULL,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
  created_by        UUID          NOT NULL,
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_by        UUID          NOT NULL,
  CONSTRAINT equipo_parte_tenant_key_unique UNIQUE (tenant_id, idempotency_key)
);

CREATE INDEX equipo_parte_tenant_idx  ON equipo_parte(tenant_id);
CREATE INDEX equipo_parte_parte_idx   ON equipo_parte(parte_id);
CREATE INDEX equipo_parte_equipo_idx  ON equipo_parte(equipo_id);

ALTER TABLE equipo_parte ENABLE ROW LEVEL SECURITY;
CREATE POLICY equipo_parte_tenant_isolation ON equipo_parte
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE ON equipo_parte TO tributia_app;

CREATE TRIGGER audit_equipo_parte
  AFTER INSERT OR UPDATE ON equipo_parte
  FOR EACH ROW EXECUTE FUNCTION audit_row();

-- ─── 5. avance_obra ───────────────────────────────────────────────────────────
CREATE TABLE avance_obra (
  id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID          NOT NULL REFERENCES tenant(id),
  parte_id            UUID          NOT NULL REFERENCES parte_diario(id),
  partida_id          UUID          NOT NULL REFERENCES partida(id),
  cantidad_ejecutada  NUMERIC(18,4) NOT NULL,
  unidad              VARCHAR(50)   NOT NULL,
  observaciones       TEXT,
  evento_id           UUID,
  idempotency_key     VARCHAR(100)  NOT NULL,
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
  created_by          UUID          NOT NULL,
  updated_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_by          UUID          NOT NULL,
  CONSTRAINT avance_obra_tenant_key_unique UNIQUE (tenant_id, idempotency_key)
);

CREATE INDEX avance_obra_tenant_idx  ON avance_obra(tenant_id);
CREATE INDEX avance_obra_parte_idx   ON avance_obra(parte_id);
CREATE INDEX avance_obra_partida_idx ON avance_obra(tenant_id, partida_id);

ALTER TABLE avance_obra ENABLE ROW LEVEL SECURITY;
CREATE POLICY avance_obra_tenant_isolation ON avance_obra
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE ON avance_obra TO tributia_app;

CREATE TRIGGER audit_avance_obra
  AFTER INSERT OR UPDATE ON avance_obra
  FOR EACH ROW EXECUTE FUNCTION audit_row();

-- ─── 6. foto_parte ────────────────────────────────────────────────────────────
CREATE TABLE foto_parte (
  id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID          NOT NULL REFERENCES tenant(id),
  parte_id    UUID          NOT NULL REFERENCES parte_diario(id),
  archivo_id  UUID          NOT NULL REFERENCES archivo(id),
  latitud     NUMERIC(10,7),
  longitud    NUMERIC(10,7),
  descripcion TEXT,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT now(),
  created_by  UUID          NOT NULL,
  updated_at  TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_by  UUID          NOT NULL
);

CREATE INDEX foto_parte_tenant_idx ON foto_parte(tenant_id);
CREATE INDEX foto_parte_parte_idx  ON foto_parte(parte_id);

ALTER TABLE foto_parte ENABLE ROW LEVEL SECURITY;
CREATE POLICY foto_parte_tenant_isolation ON foto_parte
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE ON foto_parte TO tributia_app;

CREATE TRIGGER audit_foto_parte
  AFTER INSERT OR UPDATE ON foto_parte
  FOR EACH ROW EXECUTE FUNCTION audit_row();

-- ─── 7. rfi ───────────────────────────────────────────────────────────────────
CREATE TABLE rfi (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID          NOT NULL REFERENCES tenant(id),
  proyecto_id     UUID          NOT NULL REFERENCES proyecto(id),
  numero          INTEGER       NOT NULL,
  titulo          VARCHAR(500)  NOT NULL,
  descripcion     TEXT          NOT NULL,
  impacto         VARCHAR(20)   NOT NULL DEFAULT 'NINGUNO'
    CHECK (impacto IN ('NINGUNO','DIAS','COSTO','AMBOS')),
  impacto_dias    INTEGER,
  impacto_monto   NUMERIC(18,4),
  estado          VARCHAR(20)   NOT NULL DEFAULT 'ABIERTO'
    CHECK (estado IN ('ABIERTO','RESPONDIDO','CERRADO')),
  asignado_a      UUID,
  fecha_limite    DATE,
  respuesta       TEXT,
  fecha_respuesta DATE,
  respondido_por  UUID,
  cerrado_en      TIMESTAMPTZ,
  cerrado_por     UUID,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
  created_by      UUID          NOT NULL,
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_by      UUID          NOT NULL,
  deleted_at      TIMESTAMPTZ,
  deleted_by      UUID,
  CONSTRAINT rfi_tenant_proyecto_numero_unique UNIQUE (tenant_id, proyecto_id, numero)
);

CREATE INDEX rfi_tenant_idx   ON rfi(tenant_id);
CREATE INDEX rfi_proyecto_idx ON rfi(proyecto_id);

ALTER TABLE rfi ENABLE ROW LEVEL SECURITY;
CREATE POLICY rfi_tenant_isolation ON rfi
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE ON rfi TO tributia_app;

CREATE TRIGGER audit_rfi
  AFTER INSERT OR UPDATE ON rfi
  FOR EACH ROW EXECUTE FUNCTION audit_row();

-- ─── 8. punch_list_item ───────────────────────────────────────────────────────
CREATE TABLE punch_list_item (
  id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID          NOT NULL REFERENCES tenant(id),
  proyecto_id           UUID          NOT NULL REFERENCES proyecto(id),
  descripcion           TEXT          NOT NULL,
  ubicacion             VARCHAR(500),
  responsable_id        UUID,
  fecha_limite          DATE,
  estado                VARCHAR(20)   NOT NULL DEFAULT 'PENDIENTE'
    CHECK (estado IN ('PENDIENTE','EN_PROGRESO','COMPLETADO','RECHAZADO')),
  evidencia_archivo_id  UUID,
  resuelto_en           TIMESTAMPTZ,
  resuelto_por          UUID,
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
  created_by            UUID          NOT NULL,
  updated_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_by            UUID          NOT NULL
);

CREATE INDEX punch_list_tenant_idx   ON punch_list_item(tenant_id);
CREATE INDEX punch_list_proyecto_idx ON punch_list_item(proyecto_id);
CREATE INDEX punch_list_estado_idx   ON punch_list_item(proyecto_id, estado);

ALTER TABLE punch_list_item ENABLE ROW LEVEL SECURITY;
CREATE POLICY punch_list_tenant_isolation ON punch_list_item
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE ON punch_list_item TO tributia_app;

CREATE TRIGGER audit_punch_list_item
  AFTER INSERT OR UPDATE ON punch_list_item
  FOR EACH ROW EXECUTE FUNCTION audit_row();
