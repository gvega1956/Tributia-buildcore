import {
  pgTable,
  uuid,
  varchar,
  jsonb,
  timestamp,
  index,
  check,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { newId } from '@tributia/shared';
import type { TipoEvento, EstadoEvento } from '@tributia/ledger';
import { tenants } from '../core/tenant.js';
import { empresas } from '../core/tenant.js';

/**
 * evento_operativo — tabla central del Event Ledger (P2).
 *
 * APPEND-ONLY: la migración REVOCA UPDATE y DELETE a tributia_app y añade
 * un trigger `enforce_append_only_evento_operativo` que bloquea cualquier
 * intento de mutación directa. La única mutación permitida (marcado de
 * reversado) ocurre a través de la función SECURITY DEFINER
 * `ledger_marcar_reversado(id, reversa_id)`.
 *
 * Invariante de imputación (P3): proyecto_id IS NOT NULL OR centro_costo_id IS NOT NULL.
 * Todo hecho operativo tiene destino de costo.
 */
export const eventosOperativos = pgTable(
  'evento_operativo',
  {
    id: uuid('id').primaryKey().$defaultFn(() => newId()),

    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),

    empresaId: uuid('empresa_id')
      .notNull()
      .references(() => empresas.id),

    // proyecto_id sin FK todavía — la tabla proyecto se crea en Capa 1.
    proyectoId: uuid('proyecto_id'),

    // centro_costo_id: imputación administrativa cuando no hay proyecto.
    centroCostoId: uuid('centro_costo_id'),

    tipoEvento: varchar('tipo_evento', { length: 50 })
      .notNull()
      .$type<TipoEvento>(),

    // Momento en que ocurrió el hecho de negocio (puede diferir de created_at).
    ocurridoEn: timestamp('ocurrido_en', { withTimezone: true })
      .notNull()
      .default(sql`now()`),

    usuarioId: uuid('usuario_id').notNull(),

    payload: jsonb('payload').notNull(),

    // Imputación a partida de la EDT (P5) — FK añadida en migración 0012.
    partidaId: uuid('partida_id'),

    // Referencia al documento de origen (OC, recepción, parte diario, etc.).
    referenciaId: uuid('referencia_id'),
    referenciaTabla: varchar('referencia_tabla', { length: 100 }),

    // Clave de idempotencia para sincronización móvil (globalmente única).
    idempotencyKey: varchar('idempotency_key', { length: 255 }).notNull(),

    estado: varchar('estado', { length: 20 })
      .notNull()
      .default('registrado')
      .$type<EstadoEvento>(),

    // Referencia al evento de reversa cuando este evento queda reversado.
    eventoReversaId: uuid('evento_reversa_id'),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),

    createdBy: uuid('created_by').notNull(),
  },
  (t) => ({
    tenantIdx: index('evento_tenant_id_idx').on(t.tenantId),
    tipoEstadoIdx: index('evento_tipo_estado_idx').on(t.tipoEvento, t.estado),
    ocurridoEnIdx: index('evento_ocurrido_en_idx').on(t.ocurridoEn),
    proyectoIdx: index('evento_proyecto_id_idx').on(t.proyectoId),
    idempotencyKeyUniq: uniqueIndex('evento_idempotency_key_unique').on(t.idempotencyKey),

    tipoEventoCheck: check(
      'evento_tipo_evento_check',
      sql`${t.tipoEvento} IN (
        'recepcion_material','consumo_material','transferencia_almacen',
        'avance_partida','hora_equipo','hora_personal',
        'recepcion_factura_proveedor','emision_factura_cliente',
        'pago_emitido','cobro_recibido','avance_subcontrato',
        'retencion_aplicada','combustible_cargado','mantenimiento_ejecutado',
        'orden_cambio_aprobada','ajuste_inventario',
        'emision_oc','recepcion_oc','emision_ecf',
        'evento_reversa'
      )`,
    ),

    estadoCheck: check(
      'evento_estado_check',
      sql`${t.estado} IN ('registrado','validado','contabilizado','reversado')`,
    ),

    // P3: todo evento debe imputarse a proyecto o a centro de costo.
    imputacionCheck: check(
      'evento_imputacion_check',
      sql`${t.proyectoId} IS NOT NULL OR ${t.centroCostoId} IS NOT NULL`,
    ),
  }),
);

export type EventoOperativoInsert = typeof eventosOperativos.$inferInsert;
export type EventoOperativoSelect = typeof eventosOperativos.$inferSelect;
