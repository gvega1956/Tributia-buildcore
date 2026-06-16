-- Migration 0026: Emisión de e-CF — Sesión 4 Capa 2 (§17 arquitectura.md, ADR-0007)
--
-- Cada empresa es su propio emisor electrónico ante la DGII. El middleware
-- e-CF es un servicio externo ya existente (no se modela aquí, solo el
-- puerto vive en código). Esta migración crea: configuración del emisor por
-- empresa (certificado SOLO por referencia — nunca el material en sí),
-- secuencia de NCF por tipo, el e-CF emitido (comprobante_ecf) y su acuse.

-- ─── 1. configuracion_emisor_ecf ──────────────────────────────────────────────

CREATE TABLE configuracion_emisor_ecf (
  id                      UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID          NOT NULL REFERENCES tenant(id),
  empresa_id              UUID          NOT NULL REFERENCES empresa(id),
  ambiente                VARCHAR(20)   NOT NULL DEFAULT 'TEST'
                                        CHECK (ambiente IN ('TEST','CERTIFICACION','PRODUCCION')),
  rnc_emisor              VARCHAR(9)    NOT NULL,
  razon_social_emisor     VARCHAR(200)  NOT NULL,
  certificado_referencia  VARCHAR(500)  NOT NULL,
  activo                  BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at              TIMESTAMPTZ   NOT NULL DEFAULT now(),
  created_by              UUID          NOT NULL,
  updated_at              TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_by              UUID          NOT NULL,
  deleted_at              TIMESTAMPTZ,
  deleted_by              UUID
);

CREATE UNIQUE INDEX config_emisor_ecf_empresa_unique ON configuracion_emisor_ecf(empresa_id);
CREATE INDEX config_emisor_ecf_tenant_idx ON configuracion_emisor_ecf(tenant_id);

-- ─── 2. secuencia_ecf ─────────────────────────────────────────────────────────

CREATE TABLE secuencia_ecf (
  id                      UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID          NOT NULL REFERENCES tenant(id),
  empresa_id              UUID          NOT NULL REFERENCES empresa(id),
  tipo_ecf                VARCHAR(3)    NOT NULL CHECK (tipo_ecf IN ('E31','E32','E33','E34')),
  proximo_numero          INTEGER       NOT NULL DEFAULT 1,
  rango_autorizado_desde  INTEGER,
  rango_autorizado_hasta  INTEGER,
  created_at              TIMESTAMPTZ   NOT NULL DEFAULT now(),
  created_by              UUID          NOT NULL,
  updated_at              TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_by              UUID          NOT NULL
);

CREATE UNIQUE INDEX secuencia_ecf_empresa_tipo_unique ON secuencia_ecf(empresa_id, tipo_ecf);
CREATE INDEX secuencia_ecf_tenant_idx ON secuencia_ecf(tenant_id);

-- ─── 3. comprobante_ecf ─────────────────────────────────────────────────────────

CREATE TABLE comprobante_ecf (
  id                              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                       UUID          NOT NULL REFERENCES tenant(id),
  empresa_id                      UUID          NOT NULL REFERENCES empresa(id),
  proyecto_id                     UUID          NOT NULL REFERENCES proyecto(id),
  factura_cliente_id              UUID          REFERENCES factura_cliente(id),
  tipo_ecf                        VARCHAR(3)    NOT NULL CHECK (tipo_ecf IN ('E31','E32','E33','E34')),
  ncf                             VARCHAR(19)   NOT NULL,
  estado                          VARCHAR(20)   NOT NULL DEFAULT 'ACEPTADO'
                                                CHECK (estado IN ('ACEPTADO','RECHAZADO','CONTINGENCIA')),
  comprobante_origen_id           UUID          REFERENCES comprobante_ecf(id),
  documento                       JSONB         NOT NULL,
  hash_integridad                 VARCHAR(64)   NOT NULL,
  en_contingencia                 BOOLEAN       NOT NULL DEFAULT FALSE,
  ri_numero                       VARCHAR(50),
  ri_codigo_seguridad             VARCHAR(20),
  ri_fecha_limite_regularizacion  DATE,
  monto_subtotal                  NUMERIC(18,4) NOT NULL,
  monto_itbis                     NUMERIC(18,4) NOT NULL DEFAULT 0,
  monto_total                     NUMERIC(18,4) NOT NULL,
  moneda                          VARCHAR(3)    NOT NULL DEFAULT 'DOP',
  fecha_emision                   DATE          NOT NULL,
  retener_hasta                   DATE          NOT NULL,
  evento_id                       UUID          REFERENCES evento_operativo(id),
  created_at                      TIMESTAMPTZ   NOT NULL DEFAULT now(),
  created_by                      UUID          NOT NULL,
  updated_at                      TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_by                      UUID          NOT NULL,
  deleted_at                      TIMESTAMPTZ,
  deleted_by                      UUID
);

CREATE UNIQUE INDEX comprobante_ecf_tenant_ncf_unique ON comprobante_ecf(tenant_id, ncf);
CREATE INDEX comprobante_ecf_tenant_idx   ON comprobante_ecf(tenant_id);
CREATE INDEX comprobante_ecf_factura_idx  ON comprobante_ecf(factura_cliente_id);
CREATE INDEX comprobante_ecf_origen_idx   ON comprobante_ecf(comprobante_origen_id);

-- ─── 4. acuse_ecf ───────────────────────────────────────────────────────────────

CREATE TABLE acuse_ecf (
  id                      UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID          NOT NULL REFERENCES tenant(id),
  comprobante_ecf_id      UUID          NOT NULL REFERENCES comprobante_ecf(id),
  estado_dgii             VARCHAR(20)   NOT NULL,
  codigo_seguridad        VARCHAR(20),
  fecha_recepcion_dgii    TIMESTAMPTZ,
  payload                 JSONB         NOT NULL,
  hash_integridad         VARCHAR(64)   NOT NULL,
  retener_hasta           DATE          NOT NULL,
  created_at              TIMESTAMPTZ   NOT NULL DEFAULT now(),
  created_by              UUID          NOT NULL,
  updated_at              TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_by              UUID          NOT NULL
);

CREATE UNIQUE INDEX acuse_ecf_comprobante_unique ON acuse_ecf(comprobante_ecf_id);
CREATE INDEX acuse_ecf_tenant_idx ON acuse_ecf(tenant_id);

-- ─── 5. RLS ────────────────────────────────────────────────────────────────────

ALTER TABLE configuracion_emisor_ecf ENABLE ROW LEVEL SECURITY;
ALTER TABLE secuencia_ecf            ENABLE ROW LEVEL SECURITY;
ALTER TABLE comprobante_ecf          ENABLE ROW LEVEL SECURITY;
ALTER TABLE acuse_ecf                ENABLE ROW LEVEL SECURITY;

CREATE POLICY config_emisor_ecf_tenant_isolation ON configuracion_emisor_ecf
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY secuencia_ecf_tenant_isolation ON secuencia_ecf
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY comprobante_ecf_tenant_isolation ON comprobante_ecf
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY acuse_ecf_tenant_isolation ON acuse_ecf
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ─── 6. Permisos ─────────────────────────────────────────────────────────────

GRANT SELECT, INSERT, UPDATE ON configuracion_emisor_ecf TO tributia_app;
GRANT SELECT, INSERT, UPDATE ON secuencia_ecf            TO tributia_app;
GRANT SELECT, INSERT, UPDATE ON comprobante_ecf           TO tributia_app;
GRANT SELECT, INSERT, UPDATE ON acuse_ecf                 TO tributia_app;

-- ─── 7. Agregar 'emision_ecf' al catálogo cerrado de tipos de evento ──────────

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
    'emision_oc','recepcion_oc','emision_ecf',
    'evento_reversa'
  ));
