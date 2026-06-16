-- Migration 0025: CxC y Cubicaciones — Sesión 3 Capa 2 (§16 arquitectura.md)
--
-- Ciclo de ingresos: avance físico aprobado (ejecucion_partida.avance_cantidad,
-- ver ADR-0006) → cubicacion (certificación facturable por período, con
-- retención de garantía opcional) → factura_cliente (con retenciones del
-- cliente si es Estado) → cuenta_por_cobrar (nace del evento
-- emision_factura_cliente, nunca se digita).

-- ─── 1. proyecto: % de retención de garantía contractual ────────────────────

ALTER TABLE proyecto
  ADD COLUMN retencion_garantia_pct NUMERIC(5,2);

-- ─── 2. cubicacion ────────────────────────────────────────────────────────────

CREATE TABLE cubicacion (
  id                        UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 UUID          NOT NULL REFERENCES tenant(id),
  empresa_id                UUID          NOT NULL REFERENCES empresa(id),
  proyecto_id                UUID          NOT NULL REFERENCES proyecto(id),
  numero                    INTEGER       NOT NULL,
  fecha_corte               DATE          NOT NULL,
  retencion_garantia_pct    NUMERIC(5,2),
  monto_bruto               NUMERIC(18,4) NOT NULL,
  monto_retencion_garantia  NUMERIC(18,4) NOT NULL DEFAULT 0,
  monto_facturable          NUMERIC(18,4) NOT NULL,
  moneda                    VARCHAR(3)    NOT NULL DEFAULT 'DOP',
  estado                    VARCHAR(20)   NOT NULL DEFAULT 'EMITIDA'
                                          CHECK (estado IN ('EMITIDA','ANULADA')),
  factura_cliente_id        UUID,
  created_at                TIMESTAMPTZ   NOT NULL DEFAULT now(),
  created_by                UUID          NOT NULL,
  updated_at                TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_by                UUID          NOT NULL,
  deleted_at                TIMESTAMPTZ,
  deleted_by                UUID
);

CREATE UNIQUE INDEX cubicacion_tenant_proyecto_numero_unique ON cubicacion(tenant_id, proyecto_id, numero);
CREATE INDEX cubicacion_tenant_id_idx  ON cubicacion(tenant_id);
CREATE INDEX cubicacion_proyecto_id_idx ON cubicacion(proyecto_id);

-- ─── 3. cubicacion_linea ──────────────────────────────────────────────────────

CREATE TABLE cubicacion_linea (
  id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID          NOT NULL REFERENCES tenant(id),
  cubicacion_id       UUID          NOT NULL REFERENCES cubicacion(id),
  partida_id          UUID          NOT NULL REFERENCES partida(id),
  cantidad_anterior   NUMERIC(18,4) NOT NULL DEFAULT 0,
  cantidad_periodo    NUMERIC(18,4) NOT NULL,
  cantidad_acumulada  NUMERIC(18,4) NOT NULL,
  precio_unitario     NUMERIC(18,4) NOT NULL,
  monto               NUMERIC(18,4) NOT NULL,
  moneda              VARCHAR(3)    NOT NULL DEFAULT 'DOP',
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
  created_by          UUID          NOT NULL,
  updated_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_by          UUID          NOT NULL
);

CREATE UNIQUE INDEX cubicacion_linea_cubicacion_partida_unique ON cubicacion_linea(cubicacion_id, partida_id);
CREATE INDEX cubicacion_linea_tenant_idx     ON cubicacion_linea(tenant_id);
CREATE INDEX cubicacion_linea_cubicacion_idx ON cubicacion_linea(cubicacion_id);
CREATE INDEX cubicacion_linea_partida_idx    ON cubicacion_linea(partida_id);

-- ─── 4. factura_cliente ───────────────────────────────────────────────────────

CREATE TABLE factura_cliente (
  id                       UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                UUID          NOT NULL REFERENCES tenant(id),
  empresa_id               UUID          NOT NULL REFERENCES empresa(id),
  proyecto_id              UUID          NOT NULL REFERENCES proyecto(id),
  cliente_id               UUID          NOT NULL REFERENCES tercero(id),
  cubicacion_id            UUID          NOT NULL REFERENCES cubicacion(id),
  numero                   VARCHAR(30)   NOT NULL,
  ncf                      VARCHAR(19),
  fecha_emision            DATE          NOT NULL,
  monto_subtotal           NUMERIC(18,4) NOT NULL,
  monto_itbis              NUMERIC(18,4) NOT NULL DEFAULT 0,
  monto_retencion_isr      NUMERIC(18,4) NOT NULL DEFAULT 0,
  monto_retencion_itbis    NUMERIC(18,4) NOT NULL DEFAULT 0,
  monto_total              NUMERIC(18,4) NOT NULL,
  monto_neto_a_cobrar      NUMERIC(18,4) NOT NULL,
  moneda                   VARCHAR(3)    NOT NULL DEFAULT 'DOP',
  estado                   VARCHAR(20)   NOT NULL DEFAULT 'EMITIDA'
                                         CHECK (estado IN ('EMITIDA','ANULADA')),
  evento_id                UUID          REFERENCES evento_operativo(id),
  created_at               TIMESTAMPTZ   NOT NULL DEFAULT now(),
  created_by               UUID          NOT NULL,
  updated_at               TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_by               UUID          NOT NULL,
  deleted_at               TIMESTAMPTZ,
  deleted_by                UUID
);

CREATE UNIQUE INDEX fac_cli_tenant_numero_unique ON factura_cliente(tenant_id, numero);
CREATE UNIQUE INDEX fac_cli_cubicacion_unique    ON factura_cliente(cubicacion_id);
CREATE INDEX fac_cli_tenant_idx   ON factura_cliente(tenant_id);
CREATE INDEX fac_cli_proyecto_idx ON factura_cliente(proyecto_id);
CREATE INDEX fac_cli_cliente_idx  ON factura_cliente(cliente_id);

-- Cierra el vínculo circular cubicacion <-> factura_cliente ahora que ambas existen.
ALTER TABLE cubicacion
  ADD CONSTRAINT cubicacion_factura_cliente_fk FOREIGN KEY (factura_cliente_id) REFERENCES factura_cliente(id);

-- ─── 5. cuenta_por_cobrar ─────────────────────────────────────────────────────

CREATE TABLE cuenta_por_cobrar (
  id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID          NOT NULL REFERENCES tenant(id),
  empresa_id          UUID          NOT NULL REFERENCES empresa(id),
  proyecto_id         UUID          NOT NULL REFERENCES proyecto(id),
  factura_cliente_id  UUID          NOT NULL REFERENCES factura_cliente(id),
  tercero_id          UUID          NOT NULL REFERENCES tercero(id),
  monto_original      NUMERIC(18,4) NOT NULL,
  monto_cobrado       NUMERIC(18,4) NOT NULL DEFAULT 0,
  moneda              VARCHAR(3)    NOT NULL DEFAULT 'DOP',
  fecha_emision       DATE          NOT NULL,
  fecha_vencimiento   DATE,
  estado              VARCHAR(20)   NOT NULL DEFAULT 'PENDIENTE'
                                    CHECK (estado IN ('PENDIENTE','PAGADA_PARCIAL','PAGADA_TOTAL','ANULADA')),
  evento_origen_id    UUID          NOT NULL REFERENCES evento_operativo(id),
  asiento_id          UUID          REFERENCES asiento_contable(id),
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
  created_by          UUID          NOT NULL,
  updated_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_by          UUID          NOT NULL
);

CREATE INDEX cxc_tenant_id_idx  ON cuenta_por_cobrar(tenant_id);
CREATE INDEX cxc_tercero_id_idx ON cuenta_por_cobrar(tercero_id);
CREATE INDEX cxc_proyecto_id_idx ON cuenta_por_cobrar(proyecto_id);

-- ─── 6. RLS ──────────────────────────────────────────────────────────────────

ALTER TABLE cubicacion       ENABLE ROW LEVEL SECURITY;
ALTER TABLE cubicacion_linea ENABLE ROW LEVEL SECURITY;
ALTER TABLE factura_cliente  ENABLE ROW LEVEL SECURITY;
ALTER TABLE cuenta_por_cobrar ENABLE ROW LEVEL SECURITY;

CREATE POLICY cubicacion_tenant_isolation ON cubicacion
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY cubicacion_linea_tenant_isolation ON cubicacion_linea
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY fac_cli_tenant_isolation ON factura_cliente
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY cxc_tenant_isolation ON cuenta_por_cobrar
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ─── 7. Permisos ─────────────────────────────────────────────────────────────

GRANT SELECT, INSERT, UPDATE ON cubicacion        TO tributia_app;
GRANT SELECT, INSERT, UPDATE ON cubicacion_linea  TO tributia_app;
GRANT SELECT, INSERT, UPDATE ON factura_cliente   TO tributia_app;
GRANT SELECT, INSERT, UPDATE ON cuenta_por_cobrar TO tributia_app;
