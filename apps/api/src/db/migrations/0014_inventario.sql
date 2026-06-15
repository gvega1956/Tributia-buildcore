-- =============================================================================
-- 0014_inventario.sql — Módulo de inventario y almacenes (Sesión 4 Capa 1)
-- =============================================================================
-- Tablas: almacen, ubicacion_almacen, stock_almacen,
--         movimiento_inventario, conteo_fisico, linea_conteo_fisico,
--         herramienta_asignada
-- Todas con tenant_id + RLS + auditoría.
-- =============================================================================

-- ─── almacen ─────────────────────────────────────────────────────────────────

CREATE TABLE almacen (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID          NOT NULL REFERENCES tenant(id),
  empresa_id        UUID          NOT NULL REFERENCES empresa(id),
  proyecto_id       UUID,
  tipo              VARCHAR(20)   NOT NULL
    CONSTRAINT almacen_tipo_check CHECK (tipo IN ('CENTRAL','OBRA','TRANSITO')),
  codigo            VARCHAR(50)   NOT NULL,
  nombre            VARCHAR(200)  NOT NULL,
  ubicacion_fisica  TEXT,
  activo            BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
  created_by        UUID          NOT NULL,
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_by        UUID          NOT NULL,
  deleted_at        TIMESTAMPTZ,
  deleted_by        UUID,
  CONSTRAINT almacen_tenant_codigo_unique UNIQUE (tenant_id, codigo)
);

CREATE INDEX almacen_tenant_idx   ON almacen (tenant_id);
CREATE INDEX almacen_empresa_idx  ON almacen (empresa_id);

ALTER TABLE almacen ENABLE ROW LEVEL SECURITY;

CREATE POLICY almacen_tenant_isolation ON almacen
  USING (tenant_id = current_setting('app.tenant_id', TRUE)::UUID);

GRANT SELECT, INSERT, UPDATE ON almacen TO tributia_app;

-- ─── ubicacion_almacen ────────────────────────────────────────────────────────

CREATE TABLE ubicacion_almacen (
  id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID          NOT NULL REFERENCES tenant(id),
  almacen_id  UUID          NOT NULL REFERENCES almacen(id),
  codigo      VARCHAR(50)   NOT NULL,
  nombre      VARCHAR(200)  NOT NULL,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT now(),
  created_by  UUID          NOT NULL,
  updated_at  TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_by  UUID          NOT NULL,
  CONSTRAINT ubicacion_almacen_codigo_unique UNIQUE (almacen_id, codigo)
);

CREATE INDEX ubicacion_almacen_tenant_idx   ON ubicacion_almacen (tenant_id);
CREATE INDEX ubicacion_almacen_almacen_idx  ON ubicacion_almacen (almacen_id);

ALTER TABLE ubicacion_almacen ENABLE ROW LEVEL SECURITY;

CREATE POLICY ubicacion_almacen_tenant_isolation ON ubicacion_almacen
  USING (tenant_id = current_setting('app.tenant_id', TRUE)::UUID);

GRANT SELECT, INSERT, UPDATE ON ubicacion_almacen TO tributia_app;

-- ─── stock_almacen ────────────────────────────────────────────────────────────

CREATE TABLE stock_almacen (
  id                       UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                UUID          NOT NULL REFERENCES tenant(id),
  almacen_id               UUID          NOT NULL REFERENCES almacen(id),
  insumo_id                UUID          NOT NULL REFERENCES insumo(id),
  cantidad                 NUMERIC(18,4) NOT NULL DEFAULT 0,
  costo_promedio_ponderado NUMERIC(18,4) NOT NULL DEFAULT 0,
  moneda                   VARCHAR(3)    NOT NULL DEFAULT 'DOP',
  updated_at               TIMESTAMPTZ   NOT NULL DEFAULT now(),
  CONSTRAINT stock_almacen_almacen_insumo_unique UNIQUE (almacen_id, insumo_id)
);

CREATE INDEX stock_almacen_tenant_idx ON stock_almacen (tenant_id);

ALTER TABLE stock_almacen ENABLE ROW LEVEL SECURITY;

CREATE POLICY stock_almacen_tenant_isolation ON stock_almacen
  USING (tenant_id = current_setting('app.tenant_id', TRUE)::UUID);

GRANT SELECT, INSERT, UPDATE ON stock_almacen TO tributia_app;

-- ─── movimiento_inventario ────────────────────────────────────────────────────

CREATE TABLE movimiento_inventario (
  id                   UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID          NOT NULL REFERENCES tenant(id),
  almacen_id           UUID          NOT NULL REFERENCES almacen(id),
  insumo_id            UUID          NOT NULL REFERENCES insumo(id),
  tipo_movimiento      VARCHAR(30)   NOT NULL
    CONSTRAINT movimiento_inv_tipo_check
      CHECK (tipo_movimiento IN ('ENTRADA','SALIDA','TRANSFERENCIA_SALIDA','TRANSFERENCIA_ENTRADA','AJUSTE_ENTRADA','AJUSTE_SALIDA')),
  cantidad             NUMERIC(18,4) NOT NULL,
  costo_unitario       NUMERIC(18,4) NOT NULL,
  costo_total          NUMERIC(18,4) NOT NULL,
  moneda               VARCHAR(3)    NOT NULL,
  evento_operativo_id  UUID          NOT NULL REFERENCES evento_operativo(id),
  partida_id           UUID,
  created_at           TIMESTAMPTZ   NOT NULL DEFAULT now(),
  created_by           UUID          NOT NULL
);

CREATE INDEX movimiento_inv_tenant_idx  ON movimiento_inventario (tenant_id);
CREATE INDEX movimiento_inv_almacen_idx ON movimiento_inventario (almacen_id);
CREATE INDEX movimiento_inv_insumo_idx  ON movimiento_inventario (insumo_id);
CREATE INDEX movimiento_inv_evento_idx  ON movimiento_inventario (evento_operativo_id);

ALTER TABLE movimiento_inventario ENABLE ROW LEVEL SECURITY;

CREATE POLICY movimiento_inv_tenant_isolation ON movimiento_inventario
  USING (tenant_id = current_setting('app.tenant_id', TRUE)::UUID);

-- Append-only: tributia_app puede insertar y leer, no borrar ni actualizar.
-- Primero granteamos lo necesario, luego revocamos lo que pudiera venir de GRANT ALL previo.
GRANT SELECT, INSERT ON movimiento_inventario TO tributia_app;
REVOKE UPDATE, DELETE ON movimiento_inventario FROM tributia_app;

-- ─── conteo_fisico ────────────────────────────────────────────────────────────

CREATE TABLE conteo_fisico (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID          NOT NULL REFERENCES tenant(id),
  empresa_id      UUID          NOT NULL REFERENCES empresa(id),
  almacen_id      UUID          NOT NULL REFERENCES almacen(id),
  fecha_conteo    DATE          NOT NULL,
  estado          VARCHAR(20)   NOT NULL DEFAULT 'BORRADOR'
    CONSTRAINT conteo_fisico_estado_check CHECK (estado IN ('BORRADOR','FINALIZADO','CANCELADO')),
  responsable_id  UUID          NOT NULL,
  notas           TEXT,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
  created_by      UUID          NOT NULL,
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_by      UUID          NOT NULL,
  deleted_at      TIMESTAMPTZ,
  deleted_by      UUID
);

CREATE INDEX conteo_fisico_tenant_idx  ON conteo_fisico (tenant_id);
CREATE INDEX conteo_fisico_almacen_idx ON conteo_fisico (almacen_id);

ALTER TABLE conteo_fisico ENABLE ROW LEVEL SECURITY;

CREATE POLICY conteo_fisico_tenant_isolation ON conteo_fisico
  USING (tenant_id = current_setting('app.tenant_id', TRUE)::UUID);

GRANT SELECT, INSERT, UPDATE ON conteo_fisico TO tributia_app;

-- ─── linea_conteo_fisico ─────────────────────────────────────────────────────

CREATE TABLE linea_conteo_fisico (
  id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID          NOT NULL REFERENCES tenant(id),
  conteo_id        UUID          NOT NULL REFERENCES conteo_fisico(id),
  insumo_id        UUID          NOT NULL REFERENCES insumo(id),
  cantidad_sistema NUMERIC(18,4) NOT NULL,
  cantidad_fisica  NUMERIC(18,4) NOT NULL,
  costo_unitario   NUMERIC(18,4) NOT NULL,
  moneda           VARCHAR(3)    NOT NULL DEFAULT 'DOP',
  ajuste_generado  BOOLEAN       NOT NULL DEFAULT FALSE,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
  created_by       UUID          NOT NULL,
  updated_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_by       UUID          NOT NULL
);

CREATE INDEX linea_conteo_tenant_idx ON linea_conteo_fisico (tenant_id);
CREATE INDEX linea_conteo_conteo_idx ON linea_conteo_fisico (conteo_id);

ALTER TABLE linea_conteo_fisico ENABLE ROW LEVEL SECURITY;

CREATE POLICY linea_conteo_tenant_isolation ON linea_conteo_fisico
  USING (tenant_id = current_setting('app.tenant_id', TRUE)::UUID);

GRANT SELECT, INSERT, UPDATE ON linea_conteo_fisico TO tributia_app;

-- ─── herramienta_asignada ─────────────────────────────────────────────────────

CREATE TABLE herramienta_asignada (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID          NOT NULL REFERENCES tenant(id),
  insumo_id         UUID          NOT NULL REFERENCES insumo(id),
  proyecto_id       UUID,
  asignado_a        UUID          NOT NULL,
  fecha_asignacion  DATE          NOT NULL,
  fecha_devolucion  DATE,
  estado            VARCHAR(20)   NOT NULL DEFAULT 'ASIGNADA'
    CONSTRAINT herramienta_asignada_estado_check CHECK (estado IN ('ASIGNADA','DEVUELTA','DADA_DE_BAJA')),
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
  created_by        UUID          NOT NULL,
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_by        UUID          NOT NULL,
  deleted_at        TIMESTAMPTZ,
  deleted_by        UUID
);

CREATE INDEX herramienta_asignada_tenant_idx ON herramienta_asignada (tenant_id);
CREATE INDEX herramienta_asignada_insumo_idx ON herramienta_asignada (insumo_id);

ALTER TABLE herramienta_asignada ENABLE ROW LEVEL SECURITY;

CREATE POLICY herramienta_asignada_tenant_isolation ON herramienta_asignada
  USING (tenant_id = current_setting('app.tenant_id', TRUE)::UUID);

GRANT SELECT, INSERT, UPDATE ON herramienta_asignada TO tributia_app;

-- ─── Cuenta contable 5901 (ajuste inventario) — agregada al plan base ─────────
-- No se inserta aquí: las cuentas son datos de negocio que van en seeds.
-- El handler de ajuste_inventario busca la regla_contable configurada
-- para 'ajuste_inventario' en la empresa correspondiente.
