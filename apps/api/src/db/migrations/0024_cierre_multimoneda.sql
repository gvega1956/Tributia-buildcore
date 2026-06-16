-- Migration 0024: Cierre contable mensual + Motor de tasa de cambio (Sesión 2 Capa 2)
--
-- Nuevas tablas:
--   periodo_contable   — períodos contables con estado ABIERTO/CERRADO/REABIERTO
--   tasa_cambio        — histórico de tasas por fecha (la tasa se registra EN el evento)
--   checklist_cierre   — ítems configurables que deben completarse antes del cierre
--
-- Invariante del motor:
--   Un asiento con fecha en período CERRADO es rechazado a nivel de servicio
--   (PeriodoContableService.validarPeriodoAbierto) y no puede insertarse.
--   La reapertura requiere motivo + auditoría.

-- ─── periodo_contable ─────────────────────────────────────────────────────────
-- Estado: ABIERTO (default) → CERRADO → REABIERTO → CERRADO (puede ciclar)
-- UNIQUE (empresa_id, anio, mes) garantiza un solo registro por período.

CREATE TABLE periodo_contable (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenant(id),
  empresa_id    uuid NOT NULL REFERENCES empresa(id),
  anio          smallint NOT NULL,
  mes           smallint NOT NULL,
  estado        varchar(20) NOT NULL DEFAULT 'ABIERTO',
  fecha_cierre  timestamptz,
  cerrado_por   uuid,
  fecha_reapertura  timestamptz,
  reabierto_por     uuid,
  motivo_reapertura text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid        NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    uuid        NOT NULL,
  CONSTRAINT periodo_mes_check    CHECK (mes BETWEEN 1 AND 12),
  CONSTRAINT periodo_estado_check CHECK (estado IN ('ABIERTO','CERRADO','REABIERTO')),
  CONSTRAINT periodo_empresa_anio_mes_unique UNIQUE (empresa_id, anio, mes)
);

CREATE INDEX periodo_tenant_id_idx  ON periodo_contable(tenant_id);
CREATE INDEX periodo_empresa_idx    ON periodo_contable(empresa_id, anio, mes);

COMMENT ON TABLE periodo_contable IS
  'Control de períodos contables por empresa. Estado CERRADO bloquea toda escritura de asientos y eventos para ese período.';

-- ─── tasa_cambio ──────────────────────────────────────────────────────────────
-- Histórico de tasas con granularidad diaria.
-- La tasa se registra EN el payload del evento al momento de ocurrir, nunca
-- se re-consulta. Esta tabla es la fuente de consulta en el momento de registro.

CREATE TABLE tasa_cambio (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenant(id),
  moneda_origen   varchar(3) NOT NULL,
  moneda_destino  varchar(3) NOT NULL,
  tasa            numeric(18,6) NOT NULL,
  fecha           date NOT NULL,
  fuente          varchar(100),     -- 'BCRD', 'manual', etc.
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid        NOT NULL,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid        NOT NULL,
  CONSTRAINT tasa_positiva CHECK (tasa > 0),
  CONSTRAINT tasa_cambio_unique UNIQUE (tenant_id, moneda_origen, moneda_destino, fecha)
);

CREATE INDEX tasa_cambio_tenant_fecha_idx ON tasa_cambio(tenant_id, moneda_origen, moneda_destino, fecha);

COMMENT ON TABLE tasa_cambio IS
  'Histórico de tasas de cambio por fecha. La tasa vigente se registra en el payload del evento al momento de su ocurrencia para trazabilidad histórica.';

-- ─── checklist_cierre ─────────────────────────────────────────────────────────
-- Ítems configurables por empresa y período. Los requeridos=true deben estar
-- completados antes de poder cerrar el período.

CREATE TABLE checklist_cierre (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenant(id),
  empresa_id      uuid NOT NULL REFERENCES empresa(id),
  anio            smallint NOT NULL,
  mes             smallint NOT NULL,
  nombre          varchar(200) NOT NULL,
  descripcion     text,
  requerido       boolean NOT NULL DEFAULT true,
  completado      boolean NOT NULL DEFAULT false,
  completado_por  uuid,
  completado_en   timestamptz,
  orden           integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid        NOT NULL,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid        NOT NULL,
  CONSTRAINT checklist_empresa_periodo_nombre_unique UNIQUE (empresa_id, anio, mes, nombre)
);

CREATE INDEX checklist_tenant_idx   ON checklist_cierre(tenant_id);
CREATE INDEX checklist_empresa_idx  ON checklist_cierre(empresa_id, anio, mes);

COMMENT ON TABLE checklist_cierre IS
  'Ítems del checklist de cierre por empresa y período. Ítems requeridos pendientes bloquean el cierre del período.';

-- ─── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE periodo_contable  ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasa_cambio       ENABLE ROW LEVEL SECURITY;
ALTER TABLE checklist_cierre  ENABLE ROW LEVEL SECURITY;

CREATE POLICY periodo_tenant_isolation  ON periodo_contable
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tasa_tenant_isolation     ON tasa_cambio
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY checklist_tenant_isolation ON checklist_cierre
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Grants al usuario de app
GRANT SELECT, INSERT, UPDATE ON periodo_contable TO tributia_app;
GRANT SELECT, INSERT, UPDATE ON tasa_cambio      TO tributia_app;
GRANT SELECT, INSERT, UPDATE ON checklist_cierre TO tributia_app;
