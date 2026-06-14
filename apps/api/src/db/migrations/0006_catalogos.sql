-- Migración 0006: Catálogos maestros — terceros, insumos, equipos y catálogos DGII
-- ─────────────────────────────────────────────────────────────────────────────
-- Implementa sección 4.2 y 4.4 de la arquitectura:
--   · Tercero unificado con roles activables y atributos fiscales RD
--   · Catálogo de insumos con unidades de medida y equivalencias
--   · Catálogo de equipos/maquinaria con tarifa horaria interna
--   · Catálogos DGII versionados: tipos e-CF, tasas ITBIS, tipos de retención
--
-- Invariantes DB:
--   · Tercero: al menos un rol activo (CHECK tercero_rol_check)
--   · Tercero: RNC/Cédula única por tenant (UNIQUE tercero_tenant_rnc_unique)
--   · Catálogos DGII: sin tenant_id — datos de sistema iguales para todos
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── 1. unidad_medida ─────────────────────────────────────────────────────────
CREATE TABLE unidad_medida (
  id          UUID         PRIMARY KEY,
  tenant_id   UUID         NOT NULL REFERENCES tenant(id),
  codigo      VARCHAR(10)  NOT NULL,
  nombre      VARCHAR(80)  NOT NULL,
  descripcion TEXT,
  activo      BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  created_by  UUID         NOT NULL,
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_by  UUID         NOT NULL,

  CONSTRAINT unidad_tenant_codigo_unique UNIQUE (tenant_id, codigo)
);

ALTER TABLE unidad_medida ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON unidad_medida
  USING     (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());

CREATE INDEX unidad_tenant_idx ON unidad_medida(tenant_id);
GRANT SELECT, INSERT, UPDATE ON unidad_medida TO tributia_app;

-- ─── 2. tercero ───────────────────────────────────────────────────────────────
CREATE TABLE tercero (
  id                       UUID          PRIMARY KEY,
  tenant_id                UUID          NOT NULL REFERENCES tenant(id),
  tipo_identificacion      VARCHAR(20)   NOT NULL,
  rnc_cedula               VARCHAR(20)   NOT NULL,
  nombre_comercial         VARCHAR(200)  NOT NULL,
  nombre_legal             VARCHAR(200),
  tipo_contribuyente       VARCHAR(30)   NOT NULL,
  condicion_dgii           VARCHAR(30)   NOT NULL DEFAULT 'NORMAL',
  -- Roles activables
  es_cliente               BOOLEAN       NOT NULL DEFAULT FALSE,
  es_proveedor             BOOLEAN       NOT NULL DEFAULT FALSE,
  es_subcontratista        BOOLEAN       NOT NULL DEFAULT FALSE,
  es_empleado_relacionado  BOOLEAN       NOT NULL DEFAULT FALSE,
  es_banco                 BOOLEAN       NOT NULL DEFAULT FALSE,
  es_institucion_estatal   BOOLEAN       NOT NULL DEFAULT FALSE,
  -- Retenciones override (NULL = tasa DGII vigente)
  retencion_isr_pct        NUMERIC(5,2),
  retencion_itbis_pct      NUMERIC(5,2),
  -- Contacto
  email                    VARCHAR(200),
  telefono                 VARCHAR(20),
  direccion                TEXT,
  -- Estado y auditoría
  activo                   BOOLEAN       NOT NULL DEFAULT TRUE,
  deleted_at               TIMESTAMPTZ,
  deleted_by               UUID,
  created_at               TIMESTAMPTZ   NOT NULL DEFAULT now(),
  created_by               UUID          NOT NULL,
  updated_at               TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_by               UUID          NOT NULL,

  CONSTRAINT tercero_tenant_rnc_unique UNIQUE (tenant_id, rnc_cedula),
  CONSTRAINT tercero_tipo_id_check CHECK (
    tipo_identificacion IN ('RNC','CEDULA','PASAPORTE','EXTRANJERO')
  ),
  CONSTRAINT tercero_tipo_contrib_check CHECK (
    tipo_contribuyente IN ('PERSONA_FISICA','PERSONA_JURIDICA','ENTIDAD_GUBERNAMENTAL')
  ),
  CONSTRAINT tercero_condicion_check CHECK (
    condicion_dgii IN ('NORMAL','GRAN_CONTRIBUYENTE','REGIMEN_SIMPLIFICADO')
  ),
  CONSTRAINT tercero_rol_check CHECK (
    es_cliente OR es_proveedor OR es_subcontratista
    OR es_empleado_relacionado OR es_banco OR es_institucion_estatal
  )
);

ALTER TABLE tercero ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tercero
  USING     (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());

CREATE INDEX tercero_tenant_idx ON tercero(tenant_id);
GRANT SELECT, INSERT, UPDATE ON tercero TO tributia_app;

-- ─── 3. insumo ────────────────────────────────────────────────────────────────
CREATE TABLE insumo (
  id           UUID         PRIMARY KEY,
  tenant_id    UUID         NOT NULL REFERENCES tenant(id),
  codigo       VARCHAR(50)  NOT NULL,
  nombre       VARCHAR(200) NOT NULL,
  descripcion  TEXT,
  unidad_id    UUID         NOT NULL REFERENCES unidad_medida(id),
  categoria    VARCHAR(30)  NOT NULL DEFAULT 'MATERIAL',
  codigo_dgii  VARCHAR(20),
  activo       BOOLEAN      NOT NULL DEFAULT TRUE,
  deleted_at   TIMESTAMPTZ,
  deleted_by   UUID,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  created_by   UUID         NOT NULL,
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_by   UUID         NOT NULL,

  CONSTRAINT insumo_tenant_codigo_unique UNIQUE (tenant_id, codigo),
  CONSTRAINT insumo_categoria_check CHECK (
    categoria IN ('MATERIAL','CONSUMIBLE','HERRAMIENTA_MENOR','QUIMICO','COMBUSTIBLE','OTRO')
  )
);

ALTER TABLE insumo ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON insumo
  USING     (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());

CREATE INDEX insumo_tenant_idx ON insumo(tenant_id);
GRANT SELECT, INSERT, UPDATE ON insumo TO tributia_app;

-- ─── 4. insumo_equivalencia ───────────────────────────────────────────────────
CREATE TABLE insumo_equivalencia (
  id                UUID           PRIMARY KEY,
  tenant_id         UUID           NOT NULL REFERENCES tenant(id),
  insumo_id         UUID           NOT NULL REFERENCES insumo(id),
  unidad_origen_id  UUID           NOT NULL REFERENCES unidad_medida(id),
  factor            NUMERIC(18,6)  NOT NULL,
  unidad_destino_id UUID           NOT NULL REFERENCES unidad_medida(id),

  CONSTRAINT equiv_insumo_origen_destino_unique UNIQUE (insumo_id, unidad_origen_id, unidad_destino_id)
);

ALTER TABLE insumo_equivalencia ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON insumo_equivalencia
  USING     (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());

CREATE INDEX equiv_tenant_idx ON insumo_equivalencia(tenant_id);
GRANT SELECT, INSERT, UPDATE ON insumo_equivalencia TO tributia_app;

-- ─── 5. equipo_catalogo ───────────────────────────────────────────────────────
CREATE TABLE equipo_catalogo (
  id              UUID           PRIMARY KEY,
  tenant_id       UUID           NOT NULL REFERENCES tenant(id),
  codigo          VARCHAR(50)    NOT NULL,
  nombre          VARCHAR(200)   NOT NULL,
  descripcion     TEXT,
  categoria       VARCHAR(30)    NOT NULL DEFAULT 'OTRO',
  tarifa_horaria  NUMERIC(18,4)  NOT NULL,
  moneda_tarifa   VARCHAR(3)     NOT NULL DEFAULT 'DOP',
  activo          BOOLEAN        NOT NULL DEFAULT TRUE,
  deleted_at      TIMESTAMPTZ,
  deleted_by      UUID,
  created_at      TIMESTAMPTZ    NOT NULL DEFAULT now(),
  created_by      UUID           NOT NULL,
  updated_at      TIMESTAMPTZ    NOT NULL DEFAULT now(),
  updated_by      UUID           NOT NULL,

  CONSTRAINT equipo_cat_tenant_codigo_unique UNIQUE (tenant_id, codigo),
  CONSTRAINT equipo_cat_categoria_check CHECK (
    categoria IN ('MAQUINARIA_PESADA','VEHICULO_LIVIANO','VEHICULO_PESADO',
                  'HERRAMIENTA_MAYOR','PLANTA_ELECTRICA','BOMBA','OTRO')
  )
);

ALTER TABLE equipo_catalogo ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON equipo_catalogo
  USING     (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());

CREATE INDEX equipo_cat_tenant_idx ON equipo_catalogo(tenant_id);
GRANT SELECT, INSERT, UPDATE ON equipo_catalogo TO tributia_app;

-- ─── 6. tipo_ecf (DGII — sin tenant_id) ──────────────────────────────────────
CREATE TABLE tipo_ecf (
  id           UUID         PRIMARY KEY,
  codigo       VARCHAR(3)   NOT NULL UNIQUE,
  nombre       VARCHAR(200) NOT NULL,
  descripcion  TEXT         NOT NULL,
  valido_desde DATE         NOT NULL,
  valido_hasta DATE,
  activo       BOOLEAN      NOT NULL DEFAULT TRUE
);

-- Sin RLS — datos de sistema, igual para todos los tenants
GRANT SELECT ON tipo_ecf TO tributia_app;

-- ─── 7. tasa_itbis (DGII — sin tenant_id) ────────────────────────────────────
CREATE TABLE tasa_itbis (
  id           UUID          PRIMARY KEY,
  codigo       VARCHAR(20)   NOT NULL UNIQUE,
  porcentaje   NUMERIC(5,2)  NOT NULL,
  descripcion  VARCHAR(300)  NOT NULL,
  valido_desde DATE          NOT NULL,
  valido_hasta DATE,
  activo       BOOLEAN       NOT NULL DEFAULT TRUE
);

GRANT SELECT ON tasa_itbis TO tributia_app;

-- ─── 8. tipo_retencion (DGII — sin tenant_id) ────────────────────────────────
CREATE TABLE tipo_retencion (
  id           UUID          PRIMARY KEY,
  codigo       VARCHAR(30)   NOT NULL UNIQUE,
  nombre       VARCHAR(200)  NOT NULL,
  porcentaje   NUMERIC(5,2)  NOT NULL,
  aplica_a     VARCHAR(20)   NOT NULL,
  descripcion  VARCHAR(500)  NOT NULL,
  valido_desde DATE          NOT NULL,
  valido_hasta DATE,
  activo       BOOLEAN       NOT NULL DEFAULT TRUE,

  CONSTRAINT tipo_retencion_aplica_check CHECK (
    aplica_a IN ('SERVICIOS','BIENES','AMBOS')
  )
);

GRANT SELECT ON tipo_retencion TO tributia_app;
