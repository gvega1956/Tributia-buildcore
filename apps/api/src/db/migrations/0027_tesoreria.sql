-- Migration 0027: Tesorería — Sesión 5 Capa 2 (§16 arquitectura.md)
--
-- Bancos (cuenta_bancaria + movimiento_bancario), conciliación bancaria
-- (extracto_bancario + linea_extracto), caja chica de obra
-- (fondo_caja_chica + gasto_caja_chica + reposicion_caja_chica, gateada
-- por el workflow de Capa 0) y programación de pagos por prioridad y caja
-- disponible (programacion_pago). Cierra el círculo CxC↔Banco↔CxP.

-- ─── 1. cuenta_bancaria ────────────────────────────────────────────────────

CREATE TABLE cuenta_bancaria (
  id                      UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID          NOT NULL REFERENCES tenant(id),
  empresa_id              UUID          NOT NULL REFERENCES empresa(id),
  banco_nombre            VARCHAR(200)  NOT NULL,
  numero_cuenta           VARCHAR(50)   NOT NULL,
  tipo_cuenta             VARCHAR(20)   NOT NULL DEFAULT 'CORRIENTE'
                                        CHECK (tipo_cuenta IN ('CORRIENTE','AHORROS')),
  moneda                  VARCHAR(3)    NOT NULL DEFAULT 'DOP',
  cuenta_contable_codigo  VARCHAR(20)   NOT NULL,
  saldo_actual            NUMERIC(18,4) NOT NULL DEFAULT 0,
  activo                  BOOLEAN       NOT NULL DEFAULT true,
  created_at              TIMESTAMPTZ   NOT NULL DEFAULT now(),
  created_by              UUID          NOT NULL,
  updated_at              TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_by              UUID          NOT NULL
);

CREATE UNIQUE INDEX cuenta_bancaria_numero_unique ON cuenta_bancaria(tenant_id, numero_cuenta);
CREATE INDEX cuenta_bancaria_tenant_idx  ON cuenta_bancaria(tenant_id);
CREATE INDEX cuenta_bancaria_empresa_idx ON cuenta_bancaria(empresa_id);

-- ─── 2. movimiento_bancario ────────────────────────────────────────────────

CREATE TABLE movimiento_bancario (
  id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID          NOT NULL REFERENCES tenant(id),
  empresa_id          UUID          NOT NULL REFERENCES empresa(id),
  cuenta_bancaria_id  UUID          NOT NULL REFERENCES cuenta_bancaria(id),
  tipo                VARCHAR(20)   NOT NULL CHECK (tipo IN ('DEPOSITO','RETIRO')),
  monto               NUMERIC(18,4) NOT NULL,
  moneda              VARCHAR(3)    NOT NULL DEFAULT 'DOP',
  fecha               DATE          NOT NULL,
  concepto            VARCHAR(500)  NOT NULL,
  referencia          VARCHAR(100),
  evento_origen_id    UUID          REFERENCES evento_operativo(id),
  conciliado          BOOLEAN       NOT NULL DEFAULT false,
  linea_extracto_id   UUID,
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
  created_by          UUID          NOT NULL,
  updated_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_by          UUID          NOT NULL
);

CREATE INDEX mov_bancario_tenant_idx     ON movimiento_bancario(tenant_id);
CREATE INDEX mov_bancario_cuenta_idx     ON movimiento_bancario(cuenta_bancaria_id);
CREATE INDEX mov_bancario_fecha_idx      ON movimiento_bancario(fecha);
CREATE INDEX mov_bancario_conciliado_idx ON movimiento_bancario(cuenta_bancaria_id, conciliado);

-- ─── 3. extracto_bancario ──────────────────────────────────────────────────

CREATE TABLE extracto_bancario (
  id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID          NOT NULL REFERENCES tenant(id),
  empresa_id          UUID          NOT NULL REFERENCES empresa(id),
  cuenta_bancaria_id  UUID          NOT NULL REFERENCES cuenta_bancaria(id),
  periodo_desde       DATE          NOT NULL,
  periodo_hasta       DATE          NOT NULL,
  archivo_nombre      VARCHAR(255)  NOT NULL,
  fecha_importacion   TIMESTAMPTZ   NOT NULL,
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
  created_by          UUID          NOT NULL,
  updated_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_by          UUID          NOT NULL
);

CREATE INDEX extracto_tenant_idx ON extracto_bancario(tenant_id);
CREATE INDEX extracto_cuenta_idx ON extracto_bancario(cuenta_bancaria_id);

-- ─── 4. linea_extracto ─────────────────────────────────────────────────────

CREATE TABLE linea_extracto (
  id                     UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              UUID          NOT NULL REFERENCES tenant(id),
  extracto_bancario_id   UUID          NOT NULL REFERENCES extracto_bancario(id),
  fecha                  DATE          NOT NULL,
  descripcion            VARCHAR(500)  NOT NULL,
  monto                  NUMERIC(18,4) NOT NULL,
  referencia             VARCHAR(100),
  estado                 VARCHAR(20)   NOT NULL DEFAULT 'PENDIENTE'
                                       CHECK (estado IN ('PENDIENTE','CONCILIADA','DIFERENCIA','IGNORADA')),
  movimiento_bancario_id UUID          REFERENCES movimiento_bancario(id),
  created_at             TIMESTAMPTZ   NOT NULL DEFAULT now(),
  created_by             UUID          NOT NULL,
  updated_at             TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_by             UUID          NOT NULL
);

CREATE INDEX linea_extracto_tenant_idx    ON linea_extracto(tenant_id);
CREATE INDEX linea_extracto_extracto_idx  ON linea_extracto(extracto_bancario_id);
CREATE INDEX linea_extracto_estado_idx    ON linea_extracto(estado);

-- Cierra el vínculo circular movimiento_bancario <-> linea_extracto.
ALTER TABLE movimiento_bancario
  ADD CONSTRAINT mov_bancario_linea_extracto_fk FOREIGN KEY (linea_extracto_id) REFERENCES linea_extracto(id);

-- ─── 5. fondo_caja_chica ───────────────────────────────────────────────────

CREATE TABLE fondo_caja_chica (
  id                        UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 UUID          NOT NULL REFERENCES tenant(id),
  empresa_id                UUID          NOT NULL REFERENCES empresa(id),
  proyecto_id               UUID          NOT NULL REFERENCES proyecto(id),
  responsable_id            UUID          NOT NULL REFERENCES usuario(id),
  cuenta_bancaria_origen_id UUID          NOT NULL REFERENCES cuenta_bancaria(id),
  monto_asignado            NUMERIC(18,4) NOT NULL,
  saldo_disponible          NUMERIC(18,4) NOT NULL,
  moneda                    VARCHAR(3)    NOT NULL DEFAULT 'DOP',
  estado                    VARCHAR(20)   NOT NULL DEFAULT 'ACTIVO'
                                          CHECK (estado IN ('ACTIVO','CERRADO')),
  activo                    BOOLEAN       NOT NULL DEFAULT true,
  created_at                TIMESTAMPTZ   NOT NULL DEFAULT now(),
  created_by                UUID          NOT NULL,
  updated_at                TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_by                UUID          NOT NULL
);

CREATE INDEX fondo_caja_chica_tenant_idx   ON fondo_caja_chica(tenant_id);
CREATE INDEX fondo_caja_chica_proyecto_idx ON fondo_caja_chica(proyecto_id);

-- ─── 6. gasto_caja_chica ───────────────────────────────────────────────────

CREATE TABLE gasto_caja_chica (
  id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID          NOT NULL REFERENCES tenant(id),
  fondo_id              UUID          NOT NULL REFERENCES fondo_caja_chica(id),
  fecha                 DATE          NOT NULL,
  monto                 NUMERIC(18,4) NOT NULL,
  moneda                VARCHAR(3)    NOT NULL DEFAULT 'DOP',
  concepto              VARCHAR(500)  NOT NULL,
  numero_comprobante    VARCHAR(50)   NOT NULL,
  tipo_comprobante      VARCHAR(20)   NOT NULL CHECK (tipo_comprobante IN ('FACTURA','RECIBO','NCF','OTRO')),
  proveedor_tercero_id  UUID          REFERENCES tercero(id),
  partida_id            UUID          REFERENCES partida(id),
  evento_origen_id      UUID          NOT NULL REFERENCES evento_operativo(id),
  asiento_id            UUID          REFERENCES asiento_contable(id),
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
  created_by            UUID          NOT NULL,
  updated_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_by            UUID          NOT NULL
);

CREATE INDEX gasto_caja_chica_tenant_idx ON gasto_caja_chica(tenant_id);
CREATE INDEX gasto_caja_chica_fondo_idx  ON gasto_caja_chica(fondo_id);

-- ─── 7. reposicion_caja_chica ──────────────────────────────────────────────

CREATE TABLE reposicion_caja_chica (
  id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID          NOT NULL REFERENCES tenant(id),
  fondo_id            UUID          NOT NULL REFERENCES fondo_caja_chica(id),
  monto_solicitado    NUMERIC(18,4) NOT NULL,
  moneda              VARCHAR(3)    NOT NULL DEFAULT 'DOP',
  instancia_flujo_id  UUID          REFERENCES instancia_flujo(id),
  estado              VARCHAR(20)   NOT NULL DEFAULT 'SOLICITADA'
                                    CHECK (estado IN ('SOLICITADA','APROBADA','RECHAZADA','EJECUTADA')),
  evento_origen_id    UUID          REFERENCES evento_operativo(id),
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
  created_by          UUID          NOT NULL,
  updated_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_by          UUID          NOT NULL
);

CREATE INDEX reposicion_caja_chica_tenant_idx ON reposicion_caja_chica(tenant_id);
CREATE INDEX reposicion_caja_chica_fondo_idx  ON reposicion_caja_chica(fondo_id);

-- ─── 8. programacion_pago ──────────────────────────────────────────────────

CREATE TABLE programacion_pago (
  id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID          NOT NULL REFERENCES tenant(id),
  empresa_id          UUID          NOT NULL REFERENCES empresa(id),
  cuenta_por_pagar_id UUID          NOT NULL REFERENCES cuenta_por_pagar(id),
  cuenta_bancaria_id  UUID          NOT NULL REFERENCES cuenta_bancaria(id),
  monto               NUMERIC(18,4) NOT NULL,
  moneda              VARCHAR(3)    NOT NULL DEFAULT 'DOP',
  fecha_programada    DATE          NOT NULL,
  prioridad           INTEGER       NOT NULL DEFAULT 100,
  estado              VARCHAR(20)   NOT NULL DEFAULT 'PROGRAMADO'
                                    CHECK (estado IN ('PROGRAMADO','EN_ESPERA','EMITIDO','CANCELADO')),
  motivo_espera       TEXT,
  evento_origen_id    UUID          REFERENCES evento_operativo(id),
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
  created_by          UUID          NOT NULL,
  updated_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_by          UUID          NOT NULL
);

CREATE INDEX programacion_pago_tenant_idx          ON programacion_pago(tenant_id);
CREATE INDEX programacion_pago_cuenta_bancaria_idx  ON programacion_pago(cuenta_bancaria_id);
CREATE INDEX programacion_pago_estado_prioridad_idx ON programacion_pago(estado, prioridad);

-- ─── 9. evento_operativo: nuevos tipos de evento ───────────────────────────

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
    'gasto_caja_chica','reposicion_caja_chica',
    'evento_reversa'
  ));

-- ─── 10. RLS ────────────────────────────────────────────────────────────────

ALTER TABLE cuenta_bancaria      ENABLE ROW LEVEL SECURITY;
ALTER TABLE movimiento_bancario  ENABLE ROW LEVEL SECURITY;
ALTER TABLE extracto_bancario    ENABLE ROW LEVEL SECURITY;
ALTER TABLE linea_extracto       ENABLE ROW LEVEL SECURITY;
ALTER TABLE fondo_caja_chica     ENABLE ROW LEVEL SECURITY;
ALTER TABLE gasto_caja_chica     ENABLE ROW LEVEL SECURITY;
ALTER TABLE reposicion_caja_chica ENABLE ROW LEVEL SECURITY;
ALTER TABLE programacion_pago    ENABLE ROW LEVEL SECURITY;

CREATE POLICY cuenta_bancaria_tenant_isolation ON cuenta_bancaria
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY mov_bancario_tenant_isolation ON movimiento_bancario
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY extracto_tenant_isolation ON extracto_bancario
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY linea_extracto_tenant_isolation ON linea_extracto
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY fondo_caja_chica_tenant_isolation ON fondo_caja_chica
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY gasto_caja_chica_tenant_isolation ON gasto_caja_chica
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY reposicion_caja_chica_tenant_isolation ON reposicion_caja_chica
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY programacion_pago_tenant_isolation ON programacion_pago
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ─── 11. Permisos ───────────────────────────────────────────────────────────

GRANT SELECT, INSERT, UPDATE ON cuenta_bancaria       TO tributia_app;
GRANT SELECT, INSERT, UPDATE ON movimiento_bancario   TO tributia_app;
GRANT SELECT, INSERT, UPDATE ON extracto_bancario     TO tributia_app;
GRANT SELECT, INSERT, UPDATE ON linea_extracto        TO tributia_app;
GRANT SELECT, INSERT, UPDATE ON fondo_caja_chica      TO tributia_app;
GRANT SELECT, INSERT, UPDATE ON gasto_caja_chica      TO tributia_app;
GRANT SELECT, INSERT, UPDATE ON reposicion_caja_chica TO tributia_app;
GRANT SELECT, INSERT, UPDATE ON programacion_pago     TO tributia_app;
