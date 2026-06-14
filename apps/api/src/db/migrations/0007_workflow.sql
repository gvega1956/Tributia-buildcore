-- Migración 0007: Motor de flujos de aprobación (Capa 0 — Sección 19 arquitectura)
-- ─────────────────────────────────────────────────────────────────────────────
-- Motor genérico de flujos de aprobación configurable por tipo de documento,
-- monto y jerarquía. Soporta pasos secuenciales y paralelos, delegación y
-- escalamiento por vencimiento.
--
-- Entidades:
--   · tipo_flujo      — plantilla de flujo por tipo de documento + condición de monto
--   · paso_flujo      — pasos de la plantilla (mismo orden = paralelo)
--   · instancia_flujo — ejecución de un flujo para un documento concreto
--   · aprobacion_paso — tarea de aprobación asignada a un usuario (pista de auditoría)
--
-- Máquinas de estado:
--   instancia_flujo.estado:  EN_PROGRESO → APROBADO | RECHAZADO | CANCELADO
--   aprobacion_paso.estado:  PENDIENTE   → APROBADO | RECHAZADO | DELEGADO | VENCIDO
--
-- Todo movimiento queda registrado mediante audit_columns y el propio histórico
-- de aprobacion_paso. No se borra ninguna fila (P8).
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── 1. tipo_flujo ────────────────────────────────────────────────────────────
CREATE TABLE tipo_flujo (
  id                   UUID          PRIMARY KEY,
  tenant_id            UUID          NOT NULL REFERENCES tenant(id),
  tipo_documento       VARCHAR(50)   NOT NULL,
  nombre               VARCHAR(200)  NOT NULL,
  descripcion          TEXT,
  condicion_monto_min  NUMERIC(18,4),
  condicion_monto_max  NUMERIC(18,4),
  moneda_condicion     VARCHAR(3),
  activo               BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at           TIMESTAMPTZ   NOT NULL DEFAULT now(),
  created_by           UUID          NOT NULL,
  updated_at           TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_by           UUID          NOT NULL
);

ALTER TABLE tipo_flujo ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tipo_flujo
  USING     (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());

CREATE INDEX tipo_flujo_tenant_idx   ON tipo_flujo(tenant_id);
CREATE INDEX tipo_flujo_tipo_doc_idx ON tipo_flujo(tenant_id, tipo_documento);
GRANT SELECT, INSERT, UPDATE ON tipo_flujo TO tributia_app;

-- ─── 2. paso_flujo ────────────────────────────────────────────────────────────
CREATE TABLE paso_flujo (
  id                       UUID         PRIMARY KEY,
  tenant_id                UUID         NOT NULL REFERENCES tenant(id),
  tipo_flujo_id            UUID         NOT NULL REFERENCES tipo_flujo(id),
  orden                    INTEGER      NOT NULL,
  nombre                   VARCHAR(200) NOT NULL,
  tipo_aprobador           VARCHAR(20)  NOT NULL DEFAULT 'USUARIO',
  aprobador_id             UUID         NOT NULL,
  permite_delegacion       BOOLEAN      NOT NULL DEFAULT TRUE,
  vencimiento_horas        INTEGER,
  escalacion_aprobador_id  UUID,
  activo                   BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at               TIMESTAMPTZ  NOT NULL DEFAULT now(),
  created_by               UUID         NOT NULL,
  updated_at               TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_by               UUID         NOT NULL,

  CONSTRAINT paso_flujo_tipo_aprobador_check CHECK (tipo_aprobador IN ('USUARIO'))
);

ALTER TABLE paso_flujo ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON paso_flujo
  USING     (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());

CREATE INDEX paso_flujo_tipo_flujo_idx ON paso_flujo(tipo_flujo_id);
CREATE INDEX paso_flujo_tenant_idx     ON paso_flujo(tenant_id);
GRANT SELECT, INSERT, UPDATE ON paso_flujo TO tributia_app;

-- ─── 3. instancia_flujo ───────────────────────────────────────────────────────
CREATE TABLE instancia_flujo (
  id               UUID          PRIMARY KEY,
  tenant_id        UUID          NOT NULL REFERENCES tenant(id),
  tipo_flujo_id    UUID          NOT NULL REFERENCES tipo_flujo(id),
  tipo_documento   VARCHAR(50)   NOT NULL,
  documento_id     UUID          NOT NULL,
  documento_tabla  VARCHAR(100)  NOT NULL,
  monto            NUMERIC(18,4),
  moneda           VARCHAR(3),
  iniciado_por     UUID          NOT NULL,
  estado           VARCHAR(20)   NOT NULL DEFAULT 'EN_PROGRESO',
  paso_actual      INTEGER       NOT NULL DEFAULT 1,
  descripcion      TEXT          NOT NULL,
  metadata         JSONB,
  finalizado_en    TIMESTAMPTZ,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
  created_by       UUID          NOT NULL,
  updated_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_by       UUID          NOT NULL,

  CONSTRAINT instancia_flujo_estado_check CHECK (
    estado IN ('EN_PROGRESO','APROBADO','RECHAZADO','CANCELADO')
  )
);

ALTER TABLE instancia_flujo ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON instancia_flujo
  USING     (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());

CREATE INDEX instancia_flujo_tenant_idx   ON instancia_flujo(tenant_id);
CREATE INDEX instancia_flujo_documento_idx ON instancia_flujo(documento_id, tipo_documento);
CREATE INDEX instancia_flujo_estado_idx   ON instancia_flujo(tenant_id, estado);
GRANT SELECT, INSERT, UPDATE ON instancia_flujo TO tributia_app;

-- ─── 4. aprobacion_paso ───────────────────────────────────────────────────────
CREATE TABLE aprobacion_paso (
  id            UUID         PRIMARY KEY,
  tenant_id     UUID         NOT NULL REFERENCES tenant(id),
  instancia_id  UUID         NOT NULL REFERENCES instancia_flujo(id),
  paso_flujo_id UUID         NOT NULL REFERENCES paso_flujo(id),
  orden_paso    INTEGER      NOT NULL,
  aprobador_id  UUID         NOT NULL,
  delegado_por  UUID,
  estado        VARCHAR(20)  NOT NULL DEFAULT 'PENDIENTE',
  comentario    TEXT,
  respondido_en TIMESTAMPTZ,
  vence_en      TIMESTAMPTZ,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  created_by    UUID         NOT NULL,
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_by    UUID         NOT NULL,

  CONSTRAINT aprobacion_paso_estado_check CHECK (
    estado IN ('PENDIENTE','APROBADO','RECHAZADO','DELEGADO','VENCIDO')
  )
);

ALTER TABLE aprobacion_paso ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON aprobacion_paso
  USING     (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());

CREATE INDEX aprobacion_instancia_idx ON aprobacion_paso(instancia_id);
CREATE INDEX aprobacion_aprobador_idx ON aprobacion_paso(aprobador_id, estado);
CREATE INDEX aprobacion_tenant_idx    ON aprobacion_paso(tenant_id);
GRANT SELECT, INSERT, UPDATE ON aprobacion_paso TO tributia_app;
