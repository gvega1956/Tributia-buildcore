-- Sesión 6 Capa 2 — Flujo de Caja Proyectado por Proyecto (§16)
--
-- cubicacion_proyectada: instrumento de planificación de cobros futuros.
-- No pasa por el ledger (es planeación, no ejecución — igual que EDT/presupuesto).
-- ADR-0009 documenta la decisión síncrono vs asíncrono y el modelo de semanas.

CREATE TABLE cubicacion_proyectada (
  id                 UUID         NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id          UUID         NOT NULL REFERENCES tenant(id),
  empresa_id         UUID         NOT NULL REFERENCES empresa(id),
  proyecto_id        UUID         NOT NULL REFERENCES proyecto(id),
  fecha_proyectada   DATE         NOT NULL,
  monto_proyectado   NUMERIC(18,4) NOT NULL,
  moneda             VARCHAR(3)   NOT NULL DEFAULT 'DOP',
  descripcion        VARCHAR(500),
  cubicacion_id      UUID         REFERENCES cubicacion(id),
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
  created_by         UUID         NOT NULL,
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_by         UUID         NOT NULL,
  deleted_at         TIMESTAMPTZ,
  deleted_by         UUID
);

CREATE INDEX cub_proy_tenant_idx  ON cubicacion_proyectada(tenant_id);
CREATE INDEX cub_proy_proyecto_idx ON cubicacion_proyectada(proyecto_id);
CREATE INDEX cub_proy_fecha_idx   ON cubicacion_proyectada(fecha_proyectada);

ALTER TABLE cubicacion_proyectada ENABLE ROW LEVEL SECURITY;
CREATE POLICY cubicacion_proyectada_tenant_isolation
  ON cubicacion_proyectada
  USING (tenant_id = current_setting('app.tenant_id', TRUE)::uuid);
