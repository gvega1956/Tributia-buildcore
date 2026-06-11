-- Migración 0000: jerarquía organizacional y Row Level Security
-- ─────────────────────────────────────────────────────────────────────────────
-- Regla invariante: toda tabla de negocio lleva
--   • tenant_id UUID NOT NULL
--   • ENABLE ROW LEVEL SECURITY
--   • POLICY tenant_isolation USING (tenant_id = app_tenant_id())
--              WITH CHECK  (tenant_id = app_tenant_id())
--   • GRANT ... TO tributia_app
-- La tabla 'tenant' es la excepción: es el registro de tenants, no tiene tenant_id ni RLS.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── tenant ──────────────────────────────────────────────────────────────────
CREATE TABLE tenant (
  id           UUID        PRIMARY KEY,
  nombre       VARCHAR(200) NOT NULL,
  slug         VARCHAR(50)  NOT NULL UNIQUE,
  activo       BOOLEAN      NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  created_by   UUID         NOT NULL,
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_by   UUID         NOT NULL
);

-- tributia_app puede operar sobre tenant (necesita leerlo para resolver el tenant del request)
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant TO tributia_app;

-- ─── empresa ─────────────────────────────────────────────────────────────────
CREATE TABLE empresa (
  id           UUID        PRIMARY KEY,
  tenant_id    UUID        NOT NULL REFERENCES tenant(id),
  nombre       VARCHAR(200) NOT NULL,
  rnc          VARCHAR(9),
  activo       BOOLEAN      NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  created_by   UUID         NOT NULL,
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_by   UUID         NOT NULL
);

CREATE INDEX empresa_tenant_id_idx ON empresa(tenant_id);

ALTER TABLE empresa ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON empresa
  USING     (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON empresa TO tributia_app;

-- ─── sucursal ────────────────────────────────────────────────────────────────
CREATE TABLE sucursal (
  id           UUID        PRIMARY KEY,
  tenant_id    UUID        NOT NULL REFERENCES tenant(id),
  empresa_id   UUID        NOT NULL REFERENCES empresa(id),
  nombre       VARCHAR(200) NOT NULL,
  direccion    TEXT,
  activo       BOOLEAN      NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  created_by   UUID         NOT NULL,
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_by   UUID         NOT NULL
);

CREATE INDEX sucursal_tenant_id_idx ON sucursal(tenant_id);

ALTER TABLE sucursal ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sucursal
  USING     (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON sucursal TO tributia_app;

-- ─── centro_costo ─────────────────────────────────────────────────────────────
CREATE TABLE centro_costo (
  id           UUID        PRIMARY KEY,
  tenant_id    UUID        NOT NULL REFERENCES tenant(id),
  empresa_id   UUID        NOT NULL REFERENCES empresa(id),
  codigo       VARCHAR(50)  NOT NULL,
  nombre       VARCHAR(200) NOT NULL,
  tipo         VARCHAR(20)  NOT NULL CHECK (tipo IN ('PROYECTO', 'ADMINISTRATIVO')),
  activo       BOOLEAN      NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  created_by   UUID         NOT NULL,
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_by   UUID         NOT NULL
);

CREATE INDEX centro_costo_tenant_id_idx ON centro_costo(tenant_id);
CREATE UNIQUE INDEX centro_costo_tenant_codigo_idx ON centro_costo(tenant_id, empresa_id, codigo);

ALTER TABLE centro_costo ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON centro_costo
  USING     (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON centro_costo TO tributia_app;
