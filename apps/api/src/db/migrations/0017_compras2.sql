-- ─────────────────────────────────────────────────────────────────────────────
-- 0017_compras2.sql — Compras II: Recepción OC → Factura Proveedor → CxP
--
--   1. recepcion_oc + linea_recepcion_oc
--   2. factura_proveedor + linea_factura_proveedor
--   3. cuenta_por_pagar
--   4. anticipo_proveedor
--   5. scoring_proveedor
--   6. Agrega 'recepcion_oc' al check constraint de evento_operativo
--   7. RLS + GRANT + audit_row + prevent_delete en tablas que lo requieren
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── 1. recepcion_oc ─────────────────────────────────────────────────────────
CREATE TABLE recepcion_oc (
  id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID          NOT NULL REFERENCES tenant(id),
  empresa_id            UUID          NOT NULL REFERENCES empresa(id),
  orden_compra_id       UUID          NOT NULL REFERENCES orden_compra(id),
  numero                VARCHAR(30)   NOT NULL,
  conduce               VARCHAR(50),
  fecha_recepcion       DATE          NOT NULL,
  almacen_id            UUID          NOT NULL REFERENCES almacen(id),
  estado                VARCHAR(20)   NOT NULL DEFAULT 'BORRADOR'
    CHECK (estado IN ('BORRADOR','CONFIRMADA','CANCELADA')),
  archivo_conduce_id    UUID,
  evento_recepcion_id   UUID REFERENCES evento_operativo(id),
  notas                 TEXT,
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
  created_by            UUID          NOT NULL,
  updated_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_by            UUID          NOT NULL,
  deleted_at            TIMESTAMPTZ,
  CONSTRAINT rec_oc_tenant_numero_unique UNIQUE (tenant_id, numero)
);

CREATE INDEX rec_oc_tenant_id_idx ON recepcion_oc(tenant_id);
CREATE INDEX rec_oc_orden_compra_id_idx ON recepcion_oc(orden_compra_id);

ALTER TABLE recepcion_oc ENABLE ROW LEVEL SECURITY;
CREATE POLICY rec_oc_tenant_isolation ON recepcion_oc
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON recepcion_oc TO tributia_app;

CREATE TRIGGER audit_recepcion_oc
  AFTER INSERT OR UPDATE ON recepcion_oc
  FOR EACH ROW EXECUTE FUNCTION audit_row();

CREATE TRIGGER no_delete_recepcion_oc
  BEFORE DELETE ON recepcion_oc
  FOR EACH ROW EXECUTE FUNCTION prevent_delete();

-- ─── 2. linea_recepcion_oc ───────────────────────────────────────────────────
CREATE TABLE linea_recepcion_oc (
  id                      UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID          NOT NULL REFERENCES tenant(id),
  recepcion_oc_id         UUID          NOT NULL REFERENCES recepcion_oc(id),
  linea_orden_compra_id   UUID          NOT NULL REFERENCES linea_orden_compra(id),
  insumo_id               UUID REFERENCES insumo(id),
  partida_id              UUID          NOT NULL REFERENCES partida(id),
  cantidad_recibida       NUMERIC(18,4) NOT NULL,
  costo_unitario          NUMERIC(18,4) NOT NULL,
  moneda                  VARCHAR(3)    NOT NULL DEFAULT 'DOP',
  observacion             VARCHAR(500),
  created_at              TIMESTAMPTZ   NOT NULL DEFAULT now(),
  created_by              UUID          NOT NULL,
  updated_at              TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_by              UUID          NOT NULL
);

CREATE INDEX linea_rec_oc_tenant_idx    ON linea_recepcion_oc(tenant_id);
CREATE INDEX linea_rec_oc_recepcion_idx ON linea_recepcion_oc(recepcion_oc_id);
CREATE INDEX linea_rec_oc_linea_oc_idx  ON linea_recepcion_oc(linea_orden_compra_id);

ALTER TABLE linea_recepcion_oc ENABLE ROW LEVEL SECURITY;
CREATE POLICY linea_rec_oc_tenant_isolation ON linea_recepcion_oc
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON linea_recepcion_oc TO tributia_app;

CREATE TRIGGER audit_linea_recepcion_oc
  AFTER INSERT OR UPDATE ON linea_recepcion_oc
  FOR EACH ROW EXECUTE FUNCTION audit_row();

-- ─── 3. factura_proveedor ────────────────────────────────────────────────────
CREATE TABLE factura_proveedor (
  id                       UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                UUID          NOT NULL REFERENCES tenant(id),
  empresa_id               UUID          NOT NULL REFERENCES empresa(id),
  tercero_id               UUID          NOT NULL REFERENCES tercero(id),
  orden_compra_id          UUID REFERENCES orden_compra(id),
  recepcion_oc_id          UUID REFERENCES recepcion_oc(id),
  numero                   VARCHAR(30)   NOT NULL,
  ncf                      VARCHAR(19)   NOT NULL,
  tipo_ecf                 VARCHAR(3),
  ecf_validado             BOOLEAN       NOT NULL DEFAULT FALSE,
  fecha_factura            DATE          NOT NULL,
  fecha_vencimiento_pago   DATE,
  monto_subtotal           NUMERIC(18,4) NOT NULL,
  monto_itbis              NUMERIC(18,4) NOT NULL DEFAULT 0,
  monto_total              NUMERIC(18,4) NOT NULL,
  moneda                   VARCHAR(3)    NOT NULL DEFAULT 'DOP',
  estado_match             VARCHAR(30)   NOT NULL DEFAULT 'PENDIENTE'
    CHECK (estado_match IN ('PENDIENTE','OK','DISCREPANCIA_PRECIO','DISCREPANCIA_CANTIDAD','EXCEPCION_APROBADA')),
  tolerancia_precio_pct    NUMERIC(5,2)  NOT NULL DEFAULT 2.00,
  tolerancia_cantidad_pct  NUMERIC(5,2)  NOT NULL DEFAULT 5.00,
  estado_cxp               VARCHAR(20)   NOT NULL DEFAULT 'PENDIENTE'
    CHECK (estado_cxp IN ('PENDIENTE','APROBADA','RECHAZADA')),
  evento_id                UUID REFERENCES evento_operativo(id),
  notas                    TEXT,
  created_at               TIMESTAMPTZ   NOT NULL DEFAULT now(),
  created_by               UUID          NOT NULL,
  updated_at               TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_by               UUID          NOT NULL,
  deleted_at               TIMESTAMPTZ,
  CONSTRAINT fac_prov_tenant_numero_unique UNIQUE (tenant_id, numero),
  CONSTRAINT fac_prov_tenant_ncf_unique    UNIQUE (tenant_id, ncf)
);

CREATE INDEX fac_prov_tenant_idx  ON factura_proveedor(tenant_id);
CREATE INDEX fac_prov_tercero_idx ON factura_proveedor(tercero_id);

ALTER TABLE factura_proveedor ENABLE ROW LEVEL SECURITY;
CREATE POLICY fac_prov_tenant_isolation ON factura_proveedor
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON factura_proveedor TO tributia_app;

CREATE TRIGGER audit_factura_proveedor
  AFTER INSERT OR UPDATE ON factura_proveedor
  FOR EACH ROW EXECUTE FUNCTION audit_row();

CREATE TRIGGER no_delete_factura_proveedor
  BEFORE DELETE ON factura_proveedor
  FOR EACH ROW EXECUTE FUNCTION prevent_delete();

-- ─── 4. linea_factura_proveedor ──────────────────────────────────────────────
CREATE TABLE linea_factura_proveedor (
  id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID          NOT NULL REFERENCES tenant(id),
  factura_proveedor_id  UUID          NOT NULL REFERENCES factura_proveedor(id),
  linea_orden_compra_id UUID REFERENCES linea_orden_compra(id),
  descripcion           VARCHAR(500)  NOT NULL,
  cantidad              NUMERIC(18,4) NOT NULL,
  precio_unitario       NUMERIC(18,4) NOT NULL,
  itbis                 NUMERIC(18,4) NOT NULL DEFAULT 0,
  total                 NUMERIC(18,4) NOT NULL,
  moneda                VARCHAR(3)    NOT NULL DEFAULT 'DOP',
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
  created_by            UUID          NOT NULL,
  updated_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_by            UUID          NOT NULL
);

CREATE INDEX linea_fac_prov_tenant_idx  ON linea_factura_proveedor(tenant_id);
CREATE INDEX linea_fac_prov_factura_idx ON linea_factura_proveedor(factura_proveedor_id);

ALTER TABLE linea_factura_proveedor ENABLE ROW LEVEL SECURITY;
CREATE POLICY linea_fac_prov_tenant_isolation ON linea_factura_proveedor
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON linea_factura_proveedor TO tributia_app;

CREATE TRIGGER audit_linea_factura_proveedor
  AFTER INSERT OR UPDATE ON linea_factura_proveedor
  FOR EACH ROW EXECUTE FUNCTION audit_row();

-- ─── 5. cuenta_por_pagar ─────────────────────────────────────────────────────
CREATE TABLE cuenta_por_pagar (
  id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID          NOT NULL REFERENCES tenant(id),
  empresa_id            UUID          NOT NULL REFERENCES empresa(id),
  factura_proveedor_id  UUID          NOT NULL REFERENCES factura_proveedor(id),
  tercero_id            UUID          NOT NULL REFERENCES tercero(id),
  monto_original        NUMERIC(18,4) NOT NULL,
  monto_pagado          NUMERIC(18,4) NOT NULL DEFAULT 0,
  moneda                VARCHAR(3)    NOT NULL DEFAULT 'DOP',
  fecha_vencimiento     DATE,
  estado                VARCHAR(20)   NOT NULL DEFAULT 'PENDIENTE'
    CHECK (estado IN ('PENDIENTE','PAGADA_PARCIAL','PAGADA_TOTAL','ANULADA')),
  evento_origen_id      UUID          NOT NULL REFERENCES evento_operativo(id),
  asiento_id            UUID REFERENCES asiento_contable(id),
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
  created_by            UUID          NOT NULL,
  updated_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_by            UUID          NOT NULL
);

CREATE INDEX cxp_tenant_id_idx  ON cuenta_por_pagar(tenant_id);
CREATE INDEX cxp_tercero_id_idx ON cuenta_por_pagar(tercero_id);

ALTER TABLE cuenta_por_pagar ENABLE ROW LEVEL SECURITY;
CREATE POLICY cxp_tenant_isolation ON cuenta_por_pagar
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON cuenta_por_pagar TO tributia_app;

CREATE TRIGGER audit_cuenta_por_pagar
  AFTER INSERT OR UPDATE ON cuenta_por_pagar
  FOR EACH ROW EXECUTE FUNCTION audit_row();

CREATE TRIGGER no_delete_cuenta_por_pagar
  BEFORE DELETE ON cuenta_por_pagar
  FOR EACH ROW EXECUTE FUNCTION prevent_delete();

-- ─── 6. anticipo_proveedor ───────────────────────────────────────────────────
CREATE TABLE anticipo_proveedor (
  id                          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   UUID          NOT NULL REFERENCES tenant(id),
  empresa_id                  UUID          NOT NULL REFERENCES empresa(id),
  tercero_id                  UUID          NOT NULL REFERENCES tercero(id),
  orden_compra_id             UUID REFERENCES orden_compra(id),
  numero                      VARCHAR(30)   NOT NULL,
  monto_anticipo              NUMERIC(18,4) NOT NULL,
  monto_amortizado            NUMERIC(18,4) NOT NULL DEFAULT 0,
  moneda                      VARCHAR(3)    NOT NULL DEFAULT 'DOP',
  fecha_pago                  DATE          NOT NULL,
  estado                      VARCHAR(25)   NOT NULL DEFAULT 'PENDIENTE'
    CHECK (estado IN ('PENDIENTE','AMORTIZADO_PARCIAL','AMORTIZADO_TOTAL','ANULADO')),
  cuenta_por_pagar_aplicada_id UUID REFERENCES cuenta_por_pagar(id),
  created_at                  TIMESTAMPTZ   NOT NULL DEFAULT now(),
  created_by                  UUID          NOT NULL,
  updated_at                  TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_by                  UUID          NOT NULL,
  CONSTRAINT anticipo_prov_tenant_numero_unique UNIQUE (tenant_id, numero)
);

CREATE INDEX anticipo_prov_tenant_idx  ON anticipo_proveedor(tenant_id);
CREATE INDEX anticipo_prov_tercero_idx ON anticipo_proveedor(tercero_id);

ALTER TABLE anticipo_proveedor ENABLE ROW LEVEL SECURITY;
CREATE POLICY anticipo_prov_tenant_isolation ON anticipo_proveedor
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON anticipo_proveedor TO tributia_app;

CREATE TRIGGER audit_anticipo_proveedor
  AFTER INSERT OR UPDATE ON anticipo_proveedor
  FOR EACH ROW EXECUTE FUNCTION audit_row();

CREATE TRIGGER no_delete_anticipo_proveedor
  BEFORE DELETE ON anticipo_proveedor
  FOR EACH ROW EXECUTE FUNCTION prevent_delete();

-- ─── 7. scoring_proveedor ────────────────────────────────────────────────────
CREATE TABLE scoring_proveedor (
  id                          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   UUID          NOT NULL REFERENCES tenant(id),
  tercero_id                  UUID          NOT NULL REFERENCES tercero(id),
  total_ocs                   INT           NOT NULL DEFAULT 0,
  total_recepciones           INT           NOT NULL DEFAULT 0,
  total_recepciones_a_tiempo  INT           NOT NULL DEFAULT 0,
  total_rechazos              INT           NOT NULL DEFAULT 0,
  total_discrepancias_precio  INT           NOT NULL DEFAULT 0,
  score_puntualidad           NUMERIC(5,2)  NOT NULL DEFAULT 100.00,
  score_calidad               NUMERIC(5,2)  NOT NULL DEFAULT 100.00,
  score_precio                NUMERIC(5,2)  NOT NULL DEFAULT 100.00,
  score_total                 NUMERIC(5,2)  NOT NULL DEFAULT 100.00,
  moneda_base                 VARCHAR(3)    NOT NULL DEFAULT 'DOP',
  ultima_actualizacion        TIMESTAMPTZ   NOT NULL DEFAULT now(),
  created_at                  TIMESTAMPTZ   NOT NULL DEFAULT now(),
  created_by                  UUID          NOT NULL,
  updated_at                  TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_by                  UUID          NOT NULL,
  CONSTRAINT scoring_prov_tenant_tercero_unique UNIQUE (tenant_id, tercero_id)
);

CREATE INDEX scoring_prov_tenant_idx ON scoring_proveedor(tenant_id);

ALTER TABLE scoring_proveedor ENABLE ROW LEVEL SECURITY;
CREATE POLICY scoring_prov_tenant_isolation ON scoring_proveedor
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE ON scoring_proveedor TO tributia_app;

CREATE TRIGGER audit_scoring_proveedor
  AFTER INSERT OR UPDATE ON scoring_proveedor
  FOR EACH ROW EXECUTE FUNCTION audit_row();

-- ─── 8. Agregar 'recepcion_oc' al check constraint de evento_operativo ────────
ALTER TABLE evento_operativo
  DROP CONSTRAINT evento_tipo_evento_check;

ALTER TABLE evento_operativo
  ADD CONSTRAINT evento_tipo_evento_check CHECK (tipo_evento IN (
    'recepcion_material','consumo_material','transferencia_almacen',
    'avance_partida','hora_equipo','hora_personal',
    'recepcion_factura_proveedor','emision_factura_cliente',
    'pago_emitido','cobro_recibido','avance_subcontrato',
    'retencion_aplicada','combustible_cargado','mantenimiento_ejecutado',
    'orden_cambio_aprobada','ajuste_inventario',
    'emision_oc','recepcion_oc',
    'evento_reversa'
  ));
