-- Migración 0001: identidad, roles y permisos
-- ─────────────────────────────────────────────────────────────────────────────
-- Regla invariante aplicada en todas las tablas de negocio nuevas:
--   • tenant_id UUID NOT NULL + ENABLE ROW LEVEL SECURITY
--   • POLICY tenant_isolation USING/WITH CHECK (tenant_id = app_tenant_id())
--   • GRANT ... TO tributia_app
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── usuario ─────────────────────────────────────────────────────────────────
CREATE TABLE usuario (
  id            UUID          PRIMARY KEY,
  tenant_id     UUID          NOT NULL REFERENCES tenant(id),
  email         VARCHAR(254)  NOT NULL,
  password_hash TEXT          NOT NULL,
  nombre        VARCHAR(100)  NOT NULL,
  apellido      VARCHAR(100)  NOT NULL,
  activo        BOOLEAN       NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
  created_by    UUID          NOT NULL,
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_by    UUID          NOT NULL,
  CONSTRAINT usuario_email_tenant_unique UNIQUE (email, tenant_id)
);

CREATE INDEX usuario_tenant_id_idx ON usuario(tenant_id);

ALTER TABLE usuario ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON usuario
  USING     (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());

GRANT SELECT, INSERT, UPDATE ON usuario TO tributia_app;
-- DELETE intencional omitido: soft-delete via activo=false.

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON usuario
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── rol ─────────────────────────────────────────────────────────────────────
CREATE TABLE rol (
  id            UUID          PRIMARY KEY,
  tenant_id     UUID          NOT NULL REFERENCES tenant(id),
  nombre        VARCHAR(100)  NOT NULL,
  descripcion   TEXT,
  es_sistema    BOOLEAN       NOT NULL DEFAULT false,
  activo        BOOLEAN       NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
  created_by    UUID          NOT NULL,
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_by    UUID          NOT NULL,
  CONSTRAINT rol_nombre_tenant_unique UNIQUE (nombre, tenant_id)
);

CREATE INDEX rol_tenant_id_idx ON rol(tenant_id);

ALTER TABLE rol ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON rol
  USING     (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());

GRANT SELECT, INSERT, UPDATE ON rol TO tributia_app;

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON rol
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── rol_permiso ─────────────────────────────────────────────────────────────
-- Catálogo de permisos por rol. `permiso` referencia el catálogo cerrado en código.
CREATE TABLE rol_permiso (
  rol_id        UUID          NOT NULL REFERENCES rol(id),
  permiso       VARCHAR(100)  NOT NULL,
  tenant_id     UUID          NOT NULL REFERENCES tenant(id),
  PRIMARY KEY (rol_id, permiso)
);

CREATE INDEX rol_permiso_tenant_id_idx ON rol_permiso(tenant_id);

ALTER TABLE rol_permiso ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON rol_permiso
  USING     (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());

GRANT SELECT, INSERT, DELETE ON rol_permiso TO tributia_app;

-- ─── usuario_rol_empresa ─────────────────────────────────────────────────────
-- Matriz de permisos: usuario × empresa → rol (P9).
CREATE TABLE usuario_rol_empresa (
  id            UUID          PRIMARY KEY,
  tenant_id     UUID          NOT NULL REFERENCES tenant(id),
  usuario_id    UUID          NOT NULL REFERENCES usuario(id),
  empresa_id    UUID          NOT NULL REFERENCES empresa(id),
  rol_id        UUID          NOT NULL REFERENCES rol(id),
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
  created_by    UUID          NOT NULL,
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_by    UUID          NOT NULL,
  CONSTRAINT ure_usuario_empresa_unique UNIQUE (usuario_id, empresa_id)
);

CREATE INDEX ure_tenant_id_idx ON usuario_rol_empresa(tenant_id);

ALTER TABLE usuario_rol_empresa ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON usuario_rol_empresa
  USING     (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON usuario_rol_empresa TO tributia_app;

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON usuario_rol_empresa
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── usuario_rol_proyecto ────────────────────────────────────────────────────
-- Override de rol a nivel de proyecto (más granular que empresa).
-- FK a proyecto.id se añadirá cuando se cree la tabla proyecto (Session 5).
CREATE TABLE usuario_rol_proyecto (
  id            UUID          PRIMARY KEY,
  tenant_id     UUID          NOT NULL REFERENCES tenant(id),
  usuario_id    UUID          NOT NULL REFERENCES usuario(id),
  proyecto_id   UUID          NOT NULL,  -- FK pendiente: REFERENCES proyecto(id)
  rol_id        UUID          NOT NULL REFERENCES rol(id),
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
  created_by    UUID          NOT NULL,
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_by    UUID          NOT NULL,
  CONSTRAINT urp_usuario_proyecto_unique UNIQUE (usuario_id, proyecto_id)
);

CREATE INDEX urp_tenant_id_idx ON usuario_rol_proyecto(tenant_id);

ALTER TABLE usuario_rol_proyecto ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON usuario_rol_proyecto
  USING     (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON usuario_rol_proyecto TO tributia_app;

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON usuario_rol_proyecto
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── refresh_token ───────────────────────────────────────────────────────────
-- Almacena el hash SHA-256 de tokens de refresco opacos.
-- Rotación en cada uso; revocación explícita en logout.
CREATE TABLE refresh_token (
  id            UUID          PRIMARY KEY,
  tenant_id     UUID          NOT NULL REFERENCES tenant(id),
  usuario_id    UUID          NOT NULL REFERENCES usuario(id),
  token_hash    TEXT          NOT NULL UNIQUE,
  expires_at    TIMESTAMPTZ   NOT NULL,
  revocado      BOOLEAN       NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
  created_by    UUID          NOT NULL
);

CREATE INDEX refresh_token_tenant_id_idx  ON refresh_token(tenant_id);
CREATE INDEX refresh_token_usuario_id_idx ON refresh_token(usuario_id);

ALTER TABLE refresh_token ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON refresh_token
  USING     (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());

-- tributia_app no puede borrar físicamente tokens (soft-delete via revocado).
GRANT SELECT, INSERT, UPDATE ON refresh_token TO tributia_app;
