-- ============================================================
-- 0008_documental_notificaciones
-- Gestor documental (archivo + version_archivo) y notificaciones
-- ============================================================

-- ─── archivo ─────────────────────────────────────────────────────────────────

CREATE TABLE archivo (
  id                    UUID        PRIMARY KEY,
  tenant_id             UUID        NOT NULL REFERENCES tenant(id),

  nombre                VARCHAR(500) NOT NULL,
  descripcion           TEXT,

  -- Vínculo polimórfico — no FK para no acoplar a dominios específicos
  entidad_tipo          VARCHAR(100) NOT NULL,
  entidad_id            UUID         NOT NULL,

  categoria             VARCHAR(50)  NOT NULL DEFAULT 'OTRO'
    CONSTRAINT archivo_categoria_check
      CHECK (categoria IN ('CONTRATO','POLIZA','FIANZA','PLANO','FOTO','FACTURA','CERTIFICACION','OTRO')),

  fecha_vencimiento     DATE,
  alerta_dias_antes     INTEGER,
  ultima_alerta_enviada DATE,

  version_actual        INTEGER      NOT NULL DEFAULT 1,
  storage_key           TEXT         NOT NULL,
  content_type          VARCHAR(200) NOT NULL,
  tamano_bytes_actual   BIGINT       NOT NULL,

  activo                BOOLEAN      NOT NULL DEFAULT TRUE,

  created_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
  created_by            UUID         NOT NULL,
  updated_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_by            UUID         NOT NULL
);

CREATE INDEX archivo_tenant_idx      ON archivo (tenant_id);
CREATE INDEX archivo_entidad_idx     ON archivo (tenant_id, entidad_tipo, entidad_id);
CREATE INDEX archivo_vencimiento_idx ON archivo (tenant_id, fecha_vencimiento)
  WHERE fecha_vencimiento IS NOT NULL;

ALTER TABLE archivo ENABLE ROW LEVEL SECURITY;

CREATE POLICY archivo_tenant_isolation ON archivo
  USING (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());

GRANT SELECT, INSERT, UPDATE ON archivo TO tributia_app;

-- ─── version_archivo ─────────────────────────────────────────────────────────

CREATE TABLE version_archivo (
  id              UUID        PRIMARY KEY,
  tenant_id       UUID        NOT NULL REFERENCES tenant(id),
  archivo_id      UUID        NOT NULL REFERENCES archivo(id),

  numero_version  INTEGER     NOT NULL,
  storage_key     TEXT        NOT NULL,
  content_type    VARCHAR(200) NOT NULL,
  tamano_bytes    BIGINT      NOT NULL,

  checksum_sha256 VARCHAR(64),
  nota            TEXT,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID        NOT NULL,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by      UUID        NOT NULL,

  CONSTRAINT version_archivo_unique_version UNIQUE (archivo_id, numero_version)
);

CREATE INDEX version_archivo_archivo_idx ON version_archivo (archivo_id);
CREATE INDEX version_archivo_tenant_idx  ON version_archivo (tenant_id);

ALTER TABLE version_archivo ENABLE ROW LEVEL SECURITY;

CREATE POLICY version_archivo_tenant_isolation ON version_archivo
  USING (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());

GRANT SELECT, INSERT ON version_archivo TO tributia_app;

-- ─── notificacion ─────────────────────────────────────────────────────────────

CREATE TABLE notificacion (
  id              UUID        PRIMARY KEY,
  tenant_id       UUID        NOT NULL REFERENCES tenant(id),

  usuario_id      UUID        NOT NULL,

  tipo            VARCHAR(50) NOT NULL
    CONSTRAINT notificacion_tipo_check
      CHECK (tipo IN ('VENCIMIENTO_DOCUMENTO','FLUJO_APROBACION','SISTEMA')),

  canal           VARCHAR(20) NOT NULL DEFAULT 'IN_APP'
    CONSTRAINT notificacion_canal_check
      CHECK (canal IN ('IN_APP','EMAIL','WHATSAPP')),

  asunto          VARCHAR(500) NOT NULL,
  cuerpo          TEXT         NOT NULL,

  referencia_tipo VARCHAR(100),
  referencia_id   UUID,

  leida           BOOLEAN      NOT NULL DEFAULT FALSE,
  enviada_en      TIMESTAMPTZ,
  leida_en        TIMESTAMPTZ,

  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  created_by      UUID         NOT NULL,
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_by       UUID         NOT NULL
);

CREATE INDEX notificacion_usuario_idx ON notificacion (tenant_id, usuario_id, leida);
CREATE INDEX notificacion_tenant_idx  ON notificacion (tenant_id);

ALTER TABLE notificacion ENABLE ROW LEVEL SECURITY;

CREATE POLICY notificacion_tenant_isolation ON notificacion
  USING (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());

GRANT SELECT, INSERT, UPDATE ON notificacion TO tributia_app;
