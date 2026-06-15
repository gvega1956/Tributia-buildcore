-- Migration 0020: Órdenes de Cambio (Change Orders) — Sesión 8 Capa 1
-- §9 arquitectura.md: flujo OC + Regla de Oro (anti-fuga de margen)
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── 1. orden_cambio ─────────────────────────────────────────────────────────

CREATE TABLE orden_cambio (
  id                            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                     UUID          NOT NULL REFERENCES tenant(id),
  empresa_id                    UUID          NOT NULL REFERENCES empresa(id),
  proyecto_id                   UUID          NOT NULL REFERENCES proyecto(id),
  numero                        INTEGER       NOT NULL,
  causa                         VARCHAR(20)   NOT NULL
                                              CHECK (causa IN ('CLIENTE','DISENO','CAMPO','IMPREVISTO')),
  descripcion                   TEXT          NOT NULL,
  estado                        VARCHAR(30)   NOT NULL DEFAULT 'BORRADOR'
                                              CHECK (estado IN ('BORRADOR','ENVIADO_CLIENTE','APROBADO','RECHAZADO','ANULADO')),
  monto_estimado                NUMERIC(18,4) NOT NULL DEFAULT 0,
  monto_aprobado                NUMERIC(18,4),
  dias_adicionales_solicitados  INTEGER,
  dias_adicionales_aprobados    INTEGER,
  aprobado_por                  UUID,
  aprobado_en                   TIMESTAMPTZ,
  rechazado_por                 UUID,
  razon_rechazo                 TEXT,
  evento_id                     UUID          REFERENCES evento_operativo(id),
  created_at                    TIMESTAMPTZ   NOT NULL DEFAULT now(),
  created_by                    UUID          NOT NULL,
  updated_at                    TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_by                    UUID          NOT NULL
);

CREATE UNIQUE INDEX oc_proyecto_numero_unique ON orden_cambio(proyecto_id, numero);
CREATE INDEX oc_tenant_id_idx  ON orden_cambio(tenant_id);
CREATE INDEX oc_proyecto_id_idx ON orden_cambio(proyecto_id);

-- ─── 2. linea_orden_cambio ───────────────────────────────────────────────────

CREATE TABLE linea_orden_cambio (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID          NOT NULL REFERENCES tenant(id),
  orden_cambio_id   UUID          NOT NULL REFERENCES orden_cambio(id),
  partida_id        UUID          REFERENCES partida(id),   -- NULL si es_partida_nueva=true
  descripcion       TEXT          NOT NULL,
  es_partida_nueva  BOOLEAN       NOT NULL DEFAULT FALSE,
  cantidad_adicional NUMERIC(18,4),
  monto_adicional   NUMERIC(18,4) NOT NULL,
  tipo_impacto      VARCHAR(20)   NOT NULL DEFAULT 'COSTO'
                    CHECK (tipo_impacto IN ('COSTO','PLAZO','COSTO_Y_PLAZO')),
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
  created_by        UUID          NOT NULL,
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_by        UUID          NOT NULL
);

CREATE INDEX loc_tenant_id_idx      ON linea_orden_cambio(tenant_id);
CREATE INDEX loc_orden_cambio_id_idx ON linea_orden_cambio(orden_cambio_id);

-- ─── 3. proyecto: delta de OCs aprobadas ─────────────────────────────────────

ALTER TABLE proyecto
  ADD COLUMN presupuesto_vigente_monto NUMERIC(18,4) NOT NULL DEFAULT 0;

-- ─── 4. ejecucion_partida: proyección de OC vigente ──────────────────────────

ALTER TABLE ejecucion_partida
  ADD COLUMN presupuesto_adicional_oc NUMERIC(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN cantidad_adicional_oc    NUMERIC(18,4) NOT NULL DEFAULT 0;

-- ─── 5. RLS ──────────────────────────────────────────────────────────────────

ALTER TABLE orden_cambio       ENABLE ROW LEVEL SECURITY;
ALTER TABLE linea_orden_cambio ENABLE ROW LEVEL SECURITY;

CREATE POLICY oc_tenant_isolation ON orden_cambio
  USING (tenant_id = current_setting('app.tenant_id', TRUE)::UUID);

CREATE POLICY loc_tenant_isolation ON linea_orden_cambio
  USING (tenant_id = current_setting('app.tenant_id', TRUE)::UUID);

-- ─── 6. Permisos ─────────────────────────────────────────────────────────────

GRANT SELECT, INSERT, UPDATE ON orden_cambio       TO tributia_app;
GRANT SELECT, INSERT, UPDATE ON linea_orden_cambio TO tributia_app;
