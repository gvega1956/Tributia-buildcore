-- 0022_sincronizacion.sql
-- Sesión 10 Capa 1: Sincronización offline-first + App de campo (P7)
--
-- Dos tablas nuevas:
--   cola_sincronizacion  — cola de operaciones capturadas offline (append con dedup)
--   foto_campo           — registro de fotos georreferenciadas con subida diferida

-- ─── cola_sincronizacion ─────────────────────────────────────────────────────
-- Registra cada operación enviada desde un dispositivo de campo.
-- Estado PENDIENTE_EJECUCION → trabajado por SyncWorkerService.
-- Idempotencia garantizada por (tenant_id, idempotency_key) UNIQUE.

CREATE TABLE IF NOT EXISTS cola_sincronizacion (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID         NOT NULL REFERENCES tenant(id),
  empresa_id          UUID         NOT NULL REFERENCES empresa(id),
  usuario_id          UUID         NOT NULL,
  rol_usuario         VARCHAR(30)  NOT NULL,
  dispositivo_id      VARCHAR(100) NOT NULL,
  tipo_operacion      VARCHAR(50)  NOT NULL,
  payload             JSONB        NOT NULL,
  ocurrido_en         TIMESTAMPTZ  NOT NULL,
  idempotency_key     VARCHAR(255) NOT NULL,
  estado              VARCHAR(30)  NOT NULL DEFAULT 'PENDIENTE_EJECUCION',
  conflicto_con_id    UUID         REFERENCES cola_sincronizacion(id),
  conflicto_detalle   TEXT,
  evento_ledger_id    UUID,         -- FK blando: seteado cuando SyncWorker crea el evento
  procesado_en        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  created_by          UUID         NOT NULL,

  CONSTRAINT cola_sync_tipo_operacion_check CHECK (
    tipo_operacion IN ('consumo_material','avance_partida','hora_personal','hora_equipo')
  ),
  CONSTRAINT cola_sync_estado_check CHECK (
    estado IN ('PENDIENTE_EJECUCION','PROCESADO','CONFLICTO','ERROR','ANULADO_POR_CONFLICTO')
  ),
  CONSTRAINT cola_sync_rol_check CHECK (
    rol_usuario IN ('ADMIN','RESIDENTE','ALMACENISTA','OPERARIO')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS cola_sync_idempotency_uniq
  ON cola_sincronizacion (tenant_id, idempotency_key);

CREATE INDEX IF NOT EXISTS cola_sync_tenant_idx
  ON cola_sincronizacion (tenant_id);

CREATE INDEX IF NOT EXISTS cola_sync_estado_idx
  ON cola_sincronizacion (estado);

CREATE INDEX IF NOT EXISTS cola_sync_dispositivo_idx
  ON cola_sincronizacion (tenant_id, dispositivo_id);

-- RLS: cada tenant ve solo su cola
ALTER TABLE cola_sincronizacion ENABLE ROW LEVEL SECURITY;

CREATE POLICY cola_sync_tenant_policy ON cola_sincronizacion
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

GRANT SELECT, INSERT, UPDATE ON cola_sincronizacion TO tributia_app;

-- ─── foto_campo ───────────────────────────────────────────────────────────────
-- Fotos georreferenciadas capturadas offline, pendientes de subir a S3/MinIO.
-- Una vez subidas, pueden convertirse en foto_parte (parte diario) u otro documento.
-- hash_local garantiza deduplicación por dispositivo.

CREATE TABLE IF NOT EXISTS foto_campo (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID         NOT NULL REFERENCES tenant(id),
  empresa_id          UUID         NOT NULL REFERENCES empresa(id),
  entidad_tipo        VARCHAR(50)  NOT NULL,   -- 'parte_diario', 'recepcion_oc', 'avance_obra'
  entidad_id          UUID         NOT NULL,
  storage_key         VARCHAR(500),             -- seteado cuando se sube a S3/MinIO
  estado              VARCHAR(30)  NOT NULL DEFAULT 'PENDIENTE_SUBIDA',
  latitud             NUMERIC(10,7),
  longitud            NUMERIC(10,7),
  precision_metros    NUMERIC(8,2),
  timestamp_captura   TIMESTAMPTZ  NOT NULL,
  hash_local          VARCHAR(100) NOT NULL,   -- SHA-256 del archivo en el dispositivo
  bytes               INTEGER,
  mime_type           VARCHAR(50),
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  created_by          UUID         NOT NULL,
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_by          UUID         NOT NULL,

  CONSTRAINT foto_campo_estado_check CHECK (
    estado IN ('PENDIENTE_SUBIDA','SUBIDA','ERROR_SUBIDA')
  )
);

-- Dedup: misma foto del mismo dispositivo para la misma entidad
CREATE UNIQUE INDEX IF NOT EXISTS foto_campo_hash_entidad_uniq
  ON foto_campo (tenant_id, entidad_id, hash_local);

CREATE INDEX IF NOT EXISTS foto_campo_entidad_idx
  ON foto_campo (tenant_id, entidad_tipo, entidad_id);

CREATE INDEX IF NOT EXISTS foto_campo_estado_idx
  ON foto_campo (estado);

ALTER TABLE foto_campo ENABLE ROW LEVEL SECURITY;

CREATE POLICY foto_campo_tenant_policy ON foto_campo
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

GRANT SELECT, INSERT, UPDATE ON foto_campo TO tributia_app;
