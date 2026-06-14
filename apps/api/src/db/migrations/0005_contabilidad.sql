-- Migración 0005: Motor de reglas contables — plan de cuentas + asientos de partida doble
-- ─────────────────────────────────────────────────────────────────────────────
-- Implementa P4: Contabilidad por reglas, nunca digitada.
--
-- Tablas:
--   1. cuenta_contable       — plan de cuentas jerárquico por empresa (plantilla RD)
--   2. regla_contable        — reglas parametrizables tipo_evento → cuentas débito/crédito
--   3. asiento_contable      — asiento de partida doble vinculado al evento origen
--   4. linea_asiento         — líneas individuales (debe/haber) del asiento
--
-- Invariantes DB:
--   - Asiento automático DEBE tener evento_id (CHECK asiento_evento_obligatorio)
--   - Unicidad (evento_id, regla_id) → idempotencia de re-procesamiento
--   - linea.importe siempre > 0
--   - Función contabilidad_verificar_balance() para tests de propiedad
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── 1. cuenta_contable ──────────────────────────────────────────────────────
CREATE TABLE cuenta_contable (
  id          UUID         PRIMARY KEY,
  tenant_id   UUID         NOT NULL REFERENCES tenant(id),
  empresa_id  UUID         NOT NULL REFERENCES empresa(id),
  codigo      VARCHAR(20)  NOT NULL,
  nombre      VARCHAR(200) NOT NULL,
  tipo        VARCHAR(20)  NOT NULL,
  naturaleza  VARCHAR(10)  NOT NULL,
  nivel       INTEGER      NOT NULL,
  padre_id    UUID         REFERENCES cuenta_contable(id),
  es_movimiento BOOLEAN    NOT NULL DEFAULT FALSE,
  activo      BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  created_by  UUID         NOT NULL,
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_by  UUID         NOT NULL,

  CONSTRAINT cuenta_empresa_codigo_unique UNIQUE (tenant_id, empresa_id, codigo),
  CONSTRAINT cuenta_tipo_check      CHECK (tipo      IN ('activo','pasivo','patrimonio','ingreso','costo','gasto')),
  CONSTRAINT cuenta_naturaleza_check CHECK (naturaleza IN ('deudora','acreedora'))
);

ALTER TABLE cuenta_contable ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON cuenta_contable
  USING     (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());

CREATE INDEX cuenta_tenant_id_idx ON cuenta_contable(tenant_id);
CREATE INDEX cuenta_empresa_id_idx ON cuenta_contable(empresa_id);

GRANT SELECT, INSERT, UPDATE ON cuenta_contable TO tributia_app;

-- ─── 2. regla_contable ───────────────────────────────────────────────────────
CREATE TABLE regla_contable (
  id            UUID         PRIMARY KEY,
  tenant_id     UUID         NOT NULL REFERENCES tenant(id),
  empresa_id    UUID         NOT NULL REFERENCES empresa(id),
  tipo_evento   VARCHAR(50)  NOT NULL,
  nombre        VARCHAR(200) NOT NULL,
  descripcion   TEXT,
  activo        BOOLEAN      NOT NULL DEFAULT TRUE,
  configuracion JSONB        NOT NULL,
  prioridad     INTEGER      NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  created_by    UUID         NOT NULL,
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_by    UUID         NOT NULL
);

ALTER TABLE regla_contable ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON regla_contable
  USING     (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());

CREATE INDEX regla_tenant_tipo_idx ON regla_contable(tenant_id, tipo_evento);

GRANT SELECT, INSERT, UPDATE ON regla_contable TO tributia_app;

-- ─── 3. asiento_contable ─────────────────────────────────────────────────────
CREATE TABLE asiento_contable (
  id            UUID         PRIMARY KEY,
  tenant_id     UUID         NOT NULL REFERENCES tenant(id),
  empresa_id    UUID         NOT NULL REFERENCES empresa(id),
  numero        VARCHAR(30)  NOT NULL,
  tipo          VARCHAR(20)  NOT NULL,
  evento_id     UUID         REFERENCES evento_operativo(id),
  regla_id      UUID         REFERENCES regla_contable(id),
  fecha         DATE         NOT NULL,
  descripcion   TEXT         NOT NULL,
  estado        VARCHAR(20)  NOT NULL DEFAULT 'borrador',
  aprobado_por  UUID,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  created_by    UUID         NOT NULL,
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_by    UUID         NOT NULL,

  -- P4: asiento automático DEBE referenciar un evento del ledger.
  CONSTRAINT asiento_evento_obligatorio CHECK (
    tipo IN ('ajuste','apertura','cierre') OR evento_id IS NOT NULL
  ),
  CONSTRAINT asiento_tipo_check  CHECK (tipo   IN ('automatico','ajuste','apertura','cierre')),
  CONSTRAINT asiento_estado_check CHECK (estado IN ('borrador','confirmado','reversado'))
);

ALTER TABLE asiento_contable ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON asiento_contable
  USING     (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());

CREATE INDEX asiento_tenant_id_idx ON asiento_contable(tenant_id);
CREATE INDEX asiento_evento_id_idx  ON asiento_contable(evento_id);
CREATE INDEX asiento_fecha_idx      ON asiento_contable(fecha);

-- Idempotencia: un evento + una regla = exactamente un asiento.
-- Índice parcial: solo aplica cuando ambos son NOT NULL (asientos automáticos).
CREATE UNIQUE INDEX asiento_evento_regla_unique
  ON asiento_contable(evento_id, regla_id)
  WHERE evento_id IS NOT NULL AND regla_id IS NOT NULL;

GRANT SELECT, INSERT, UPDATE ON asiento_contable TO tributia_app;

-- ─── 4. linea_asiento ────────────────────────────────────────────────────────
CREATE TABLE linea_asiento (
  id          UUID           PRIMARY KEY,
  tenant_id   UUID           NOT NULL REFERENCES tenant(id),
  asiento_id  UUID           NOT NULL REFERENCES asiento_contable(id),
  cuenta_id   UUID           NOT NULL REFERENCES cuenta_contable(id),
  tipo        VARCHAR(5)     NOT NULL,
  importe     NUMERIC(18,4)  NOT NULL,
  moneda      VARCHAR(3)     NOT NULL DEFAULT 'DOP',
  descripcion VARCHAR(300),

  CONSTRAINT linea_tipo_check      CHECK (tipo    IN ('debe','haber')),
  CONSTRAINT linea_importe_positivo CHECK (importe > 0)
);

ALTER TABLE linea_asiento ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON linea_asiento
  USING     (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());

CREATE INDEX linea_asiento_id_idx ON linea_asiento(asiento_id);
CREATE INDEX linea_tenant_id_idx  ON linea_asiento(tenant_id);

-- tributia_app puede INSERT y SELECT; no UPDATE/DELETE (líneas inmutables).
GRANT SELECT, INSERT ON linea_asiento TO tributia_app;

-- ─── 5. Función utilitaria: verificar balance de un asiento ──────────────────
-- Usada en integration tests para la prueba de propiedad: Σdebe = Σhaber.
CREATE OR REPLACE FUNCTION contabilidad_verificar_balance(p_asiento_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(SUM(CASE WHEN tipo = 'debe'  THEN importe ELSE 0 END), 0)
       = COALESCE(SUM(CASE WHEN tipo = 'haber' THEN importe ELSE 0 END), 0)
  FROM linea_asiento
  WHERE asiento_id = p_asiento_id;
$$;

GRANT EXECUTE ON FUNCTION contabilidad_verificar_balance(UUID) TO tributia_app;
