-- Migración 0003: Event Ledger — tabla evento_operativo (P2)
-- ─────────────────────────────────────────────────────────────────────────────
-- Implementa:
--   1. Tabla evento_operativo (append-only, RLS, idempotency_key única)
--   2. Función enforce_append_only() — bloquea UPDATE/DELETE directos
--   3. Función ledger_marcar_reversado() — única vía para mutar estado (SECURITY DEFINER)
--   4. Trigger audit_evento_operativo — auditoría de cambios de estado
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── 1. Tabla evento_operativo ───────────────────────────────────────────────
CREATE TABLE evento_operativo (
  id                UUID         PRIMARY KEY,
  tenant_id         UUID         NOT NULL REFERENCES tenant(id),
  empresa_id        UUID         NOT NULL REFERENCES empresa(id),

  -- Sin FK a proyecto/partida todavía; se añade en la migración de proyectos (Capa 1).
  proyecto_id       UUID,
  centro_costo_id   UUID         REFERENCES centro_costo(id),

  tipo_evento       VARCHAR(50)  NOT NULL,
  ocurrido_en       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  usuario_id        UUID         NOT NULL,
  payload           JSONB        NOT NULL,

  referencia_id     UUID,
  referencia_tabla  VARCHAR(100),

  -- Clave de idempotencia global (UUID generado por el cliente/dispositivo).
  idempotency_key   VARCHAR(255) NOT NULL,

  estado            VARCHAR(20)  NOT NULL DEFAULT 'registrado',

  -- Referencia al evento de reversa; se setea por ledger_marcar_reversado().
  evento_reversa_id UUID         REFERENCES evento_operativo(id),

  created_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  created_by        UUID         NOT NULL,

  CONSTRAINT evento_tipo_evento_check CHECK (tipo_evento IN (
    'recepcion_material','consumo_material','transferencia_almacen',
    'avance_partida','hora_equipo','hora_personal',
    'recepcion_factura_proveedor','emision_factura_cliente',
    'pago_emitido','cobro_recibido','avance_subcontrato',
    'retencion_aplicada','combustible_cargado','mantenimiento_ejecutado',
    'orden_cambio_aprobada','ajuste_inventario','evento_reversa'
  )),
  CONSTRAINT evento_estado_check CHECK (
    estado IN ('registrado','validado','contabilizado','reversado')
  ),
  -- P3: imputación obligatoria — proyecto o centro de costo administrativo.
  CONSTRAINT evento_imputacion_check CHECK (
    proyecto_id IS NOT NULL OR centro_costo_id IS NOT NULL
  )
);

-- Índices de consulta frecuente
CREATE INDEX evento_tenant_id_idx      ON evento_operativo(tenant_id);
CREATE INDEX evento_tipo_estado_idx    ON evento_operativo(tipo_evento, estado);
CREATE INDEX evento_ocurrido_en_idx    ON evento_operativo(ocurrido_en DESC);
CREATE INDEX evento_proyecto_id_idx    ON evento_operativo(proyecto_id) WHERE proyecto_id IS NOT NULL;

-- idempotency_key globalmente única (sincronización móvil segura)
CREATE UNIQUE INDEX evento_idempotency_key_unique ON evento_operativo(idempotency_key);

-- RLS: cada request solo ve eventos de su propio tenant.
ALTER TABLE evento_operativo ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON evento_operativo
  USING     (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());

-- tributia_app puede LEER e INSERTAR eventos; NO puede hacer UPDATE ni DELETE directos.
-- La única mutación permitida es vía ledger_marcar_reversado() (SECURITY DEFINER).
GRANT SELECT, INSERT ON evento_operativo TO tributia_app;

-- ─── 2. Función enforce_append_only() ────────────────────────────────────────
-- Bloquea cualquier UPDATE o DELETE sobre evento_operativo a menos que la
-- llamada provenga de la función autorizada ledger_marcar_reversado(), que
-- establece la variable de sesión app.ledger_allow_mutation = 'true'.
--
-- La variable es SET LOCAL → expira al terminar la transacción.
-- Solo ledger_marcar_reversado() (SECURITY DEFINER) puede establecerla.
CREATE OR REPLACE FUNCTION enforce_append_only()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    IF nullif(trim(current_setting('app.ledger_allow_mutation', true)), '') IS DISTINCT FROM 'true' THEN
      RAISE EXCEPTION
        'evento_operativo es append-only. Use ledger_marcar_reversado() para cambiar el estado.'
        USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER enforce_append_only_evento_operativo
  BEFORE UPDATE OR DELETE ON evento_operativo
  FOR EACH ROW EXECUTE FUNCTION enforce_append_only();

-- ─── 3. Función ledger_marcar_reversado() ────────────────────────────────────
-- SECURITY DEFINER: única vía autorizada para mutar el estado de un evento.
-- Marca el evento original como 'reversado' y registra el ID del evento de reversa.
--
-- Precondiciones que valida:
--   a) el evento original existe en el mismo tenant
--   b) no está ya reversado
--   c) el evento de reversa existe y es de tipo 'evento_reversa'
--   d) el evento de reversa referencia al original (referencia_id = p_id)
CREATE OR REPLACE FUNCTION ledger_marcar_reversado(
  p_id         UUID,
  p_reversa_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_estado        VARCHAR(20);
  v_tipo_reversa  VARCHAR(50);
  v_ref_id        UUID;
BEGIN
  -- Validar que el evento original existe y leer su estado actual.
  SELECT estado INTO v_estado
  FROM evento_operativo
  WHERE id = p_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Evento original % no encontrado', p_id
      USING ERRCODE = 'no_data_found';
  END IF;

  IF v_estado = 'reversado' THEN
    RAISE EXCEPTION 'El evento % ya está reversado', p_id
      USING ERRCODE = 'check_violation';
  END IF;

  -- Validar el evento de reversa.
  SELECT tipo_evento, referencia_id INTO v_tipo_reversa, v_ref_id
  FROM evento_operativo
  WHERE id = p_reversa_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Evento de reversa % no encontrado', p_reversa_id
      USING ERRCODE = 'no_data_found';
  END IF;

  IF v_tipo_reversa <> 'evento_reversa' THEN
    RAISE EXCEPTION 'El evento % no es de tipo evento_reversa', p_reversa_id
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_ref_id IS DISTINCT FROM p_id THEN
    RAISE EXCEPTION 'El evento de reversa % no referencia al evento original %', p_reversa_id, p_id
      USING ERRCODE = 'check_violation';
  END IF;

  -- Autorizar la mutación (SET LOCAL expira al terminar la transacción).
  PERFORM set_config('app.ledger_allow_mutation', 'true', true);

  -- Marcar el evento original como reversado.
  UPDATE evento_operativo
  SET
    estado            = 'reversado',
    evento_reversa_id = p_reversa_id
  WHERE id = p_id;
END;
$$;

-- tributia_app puede EJECUTAR la función (corre con privilegios del owner).
GRANT EXECUTE ON FUNCTION ledger_marcar_reversado(UUID, UUID) TO tributia_app;

-- ─── 4. Trigger de auditoría ──────────────────────────────────────────────────
-- Solo audita UPDATE (cambios de estado vía ledger_marcar_reversado).
-- El INSERT no se audita aquí — el propio evento es el registro de auditoría.
CREATE TRIGGER audit_evento_operativo_update
  AFTER UPDATE ON evento_operativo
  FOR EACH ROW EXECUTE FUNCTION audit_row();
