-- Migración 0004: Motor de proyecciones — outbox + tabla de stats de ejemplo
-- ─────────────────────────────────────────────────────────────────────────────
-- Implementa:
--   1. Tabla outbox — patrón transactional outbox para handlers asíncronos
--   2. Tabla proyeccion_ledger_stats — proyección de ejemplo (conteo por tipo_evento)
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── 1. Tabla outbox ─────────────────────────────────────────────────────────
-- Cada fila = un handler asíncrono pendiente de ejecutar sobre un evento.
-- Se inserta en la misma tx que el evento → atomicidad garantizada.
-- Worker procesa con reintentos; si falla N veces → dead-letter (estado='fallido').
CREATE TABLE outbox (
  id                  UUID         PRIMARY KEY,
  evento_id           UUID         NOT NULL REFERENCES evento_operativo(id),
  handler_nombre      VARCHAR(100) NOT NULL,
  tenant_id           UUID         NOT NULL REFERENCES tenant(id),
  payload             JSONB        NOT NULL,   -- snapshot del evento al momento de encolar
  estado              VARCHAR(20)  NOT NULL DEFAULT 'pendiente',
  intentos            INTEGER      NOT NULL DEFAULT 0,
  max_intentos        INTEGER      NOT NULL DEFAULT 5,
  proximo_intento_en  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  error_ultimo        TEXT,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  procesado_en        TIMESTAMPTZ,

  -- Idempotencia: un handler procesa cada evento exactamente una vez en outbox.
  CONSTRAINT outbox_evento_handler_unique UNIQUE (evento_id, handler_nombre),
  CONSTRAINT outbox_estado_check CHECK (
    estado IN ('pendiente','procesando','completado','fallido')
  )
);

CREATE INDEX outbox_estado_proximo_idx ON outbox(estado, proximo_intento_en)
  WHERE estado IN ('pendiente','procesando');

CREATE INDEX outbox_tenant_id_idx ON outbox(tenant_id);

-- Sin RLS: el worker necesita ver entradas de todos los tenants.
-- tributia_app puede INSERT (al encolar en tx del evento) y SELECT/UPDATE
-- (para que el handler tx pueda marcar estado dentro de su propia transacción).
GRANT SELECT, INSERT, UPDATE ON outbox TO tributia_app;

-- ─── 2. Tabla proyeccion_ledger_stats ─────────────────────────────────────────
-- Proyección de ejemplo: conteo de eventos por (tenant, tipo_evento).
-- Actualizada por handlers sincronos y asíncronos vía UPSERT — garantiza idempotencia.
CREATE TABLE proyeccion_ledger_stats (
  id                   UUID         PRIMARY KEY,
  tenant_id            UUID         NOT NULL REFERENCES tenant(id),
  tipo_evento          VARCHAR(50)  NOT NULL,
  total_eventos        INTEGER      NOT NULL DEFAULT 0,
  ultima_actualizacion TIMESTAMPTZ  NOT NULL DEFAULT now(),

  CONSTRAINT stats_tenant_tipo_unique UNIQUE (tenant_id, tipo_evento)
);

CREATE INDEX stats_tenant_id_idx ON proyeccion_ledger_stats(tenant_id);

-- Con RLS: cada tenant ve solo sus propias estadísticas.
ALTER TABLE proyeccion_ledger_stats ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON proyeccion_ledger_stats
  USING     (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());

GRANT SELECT, INSERT, UPDATE ON proyeccion_ledger_stats TO tributia_app;
