-- Migración 0012: EDT / Partidas (P5 — el lenguaje común de la Capa 1)
-- ─────────────────────────────────────────────────────────────────────────────
-- Implementa:
--   1. Tabla partida (self-referencial, 3 niveles máx): Capítulo → Partida → Sub-partida
--   2. RLS: tenant_isolation
--   3. Triggers: prevent_delete + audit_row (reutiliza funciones de 0002)
--   4. Privilegios para tributia_app
--   5. partida_id FK en evento_operativo (imputación a partida desde el Ledger)
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── 1. Tabla partida ────────────────────────────────────────────────────────
CREATE TABLE partida (
  id                      UUID            PRIMARY KEY,
  tenant_id               UUID            NOT NULL REFERENCES tenant(id),
  proyecto_id             UUID            NOT NULL REFERENCES proyecto(id),

  -- auto-referencia: NULL = capítulo raíz
  parent_id               UUID            REFERENCES partida(id),

  -- 1=capítulo, 2=partida, 3=sub-partida
  nivel                   INTEGER         NOT NULL,

  -- posición 1-based entre hermanos activos; compacto (sin huecos) en todo momento
  orden                   INTEGER         NOT NULL DEFAULT 1,

  -- ej. "1.2.3"; mantenido por PartidaService (no generado en BD)
  numero_jerarquico       VARCHAR(100)    NOT NULL,

  codigo                  VARCHAR(50)     NOT NULL,
  nombre                  VARCHAR(500)    NOT NULL,
  descripcion             TEXT,

  -- FK al catálogo de unidades de medida; nullable para capítulos
  unidad_medida_id        UUID            REFERENCES unidad_medida(id),

  -- NUMERIC(18,4) — nunca float para cantidades/precios (P6 reglas de datos)
  cantidad_presupuestada  NUMERIC(18,4),
  precio_unitario         NUMERIC(18,4),

  activo                  BOOLEAN         NOT NULL DEFAULT TRUE,

  -- Auditoría obligatoria (P8)
  created_at              TIMESTAMPTZ     NOT NULL DEFAULT now(),
  created_by              UUID            NOT NULL,
  updated_at              TIMESTAMPTZ     NOT NULL DEFAULT now(),
  updated_by              UUID            NOT NULL,
  deleted_at              TIMESTAMPTZ,
  deleted_by              UUID,

  CONSTRAINT partida_nivel_check
    CHECK (nivel BETWEEN 1 AND 3),
  CONSTRAINT partida_tenant_proyecto_codigo_unique
    UNIQUE (tenant_id, proyecto_id, codigo)
);

CREATE INDEX partida_tenant_id_idx           ON partida (tenant_id);
CREATE INDEX partida_proyecto_id_idx         ON partida (proyecto_id);
CREATE INDEX partida_parent_id_idx           ON partida (parent_id);
CREATE INDEX partida_numero_jerarquico_idx   ON partida (tenant_id, proyecto_id, numero_jerarquico);

-- ─── 2. RLS ──────────────────────────────────────────────────────────────────
ALTER TABLE partida ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON partida
  USING     (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());

-- ─── 3. Triggers ─────────────────────────────────────────────────────────────
-- La EDT nunca se elimina físicamente; se usa soft-delete (deleted_at / activo).
CREATE TRIGGER no_delete_partida
  BEFORE DELETE ON partida
  FOR EACH ROW EXECUTE FUNCTION prevent_delete();

CREATE TRIGGER audit_partida
  AFTER INSERT OR UPDATE ON partida
  FOR EACH ROW EXECUTE FUNCTION audit_row();

-- ─── 4. Privilegios ──────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE ON partida TO tributia_app;

-- ─── 5. partida_id en evento_operativo (P5 — imputación al Ledger) ───────────
-- Se añade como nullable: eventos anteriores a Capa 1 no tienen imputación a partida.
-- La FK a nivel de esquema garantiza integridad referencial.
ALTER TABLE evento_operativo
  ADD COLUMN partida_id UUID REFERENCES partida(id);

-- Índice parcial: la mayoría de eventos tendrán partida_id; el WHERE optimiza
-- las consultas de "¿qué partidas tienen movimientos?" sin escanear nulls.
CREATE INDEX evento_partida_id_idx
  ON evento_operativo (partida_id)
  WHERE partida_id IS NOT NULL;
