import {
  pgTable,
  uuid,
  numeric,
  varchar,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { newId } from '@tributia/shared';
import { tenants } from '../core/tenant.js';
import { partidas } from '../proyectos/partida.js';
import { auditColumns } from '../core/audit.js';
import { timestamp } from 'drizzle-orm/pg-core';

/**
 * ejecucion_partida — proyección mutable de comprometido/devengado por partida.
 *
 * ÚNICA proyección que puede actualizarse directamente (sin pasar por evento).
 * Es actualizada de forma SÍNCRONA por handlers del ledger:
 *   - ComprasEmisionOcHandler   → comprometido  (emision_oc)
 *   - InventarioRecepcionHandler → devengado     (recepcion_material)
 *
 * El "disponible" se calcula en vivo:
 *   disponible = presupuestado − comprometido − devengado
 * donde presupuestado viene de linea_presupuesto (versión BASE aprobada).
 */
export const ejecucionPartidas = pgTable(
  'ejecucion_partida',
  {
    id: uuid('id').primaryKey().$defaultFn(() => newId()),

    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),

    partidaId: uuid('partida_id')
      .notNull()
      .references(() => partidas.id),

    // Monto total de OCs aprobadas+emitidas aún no recibidas (en moneda DOP por defecto)
    comprometido: numeric('comprometido', { precision: 18, scale: 4 })
      .notNull()
      .default('0.0000'),

    // Monto total de recepciones devengadas (costo real incurrido: materiales + MO + equipos)
    devengado: numeric('devengado', { precision: 18, scale: 4 })
      .notNull()
      .default('0.0000'),

    // Cantidad física ejecutada acumulada (actualizada por handler avance_partida).
    // El % de avance se calcula en vivo: avanceCantidad / partida.cantidad_presupuestada.
    avanceCantidad: numeric('avance_cantidad', { precision: 18, scale: 4 })
      .notNull()
      .default('0.0000'),

    // Deltas de Órdenes de Cambio aprobadas (§9). Actualizados por OrdenCambioAprobadaHandler.
    // Presupuesto vigente por partida = linea_presupuesto.total (BASE) + presupuesto_adicional_oc
    presupuestoAdicionalOc: numeric('presupuesto_adicional_oc', { precision: 18, scale: 4 })
      .notNull()
      .default('0.0000'),

    // Cantidad física adicional aprobada por OCs (para vigente check en avance)
    cantidadAdicionalOc: numeric('cantidad_adicional_oc', { precision: 18, scale: 4 })
      .notNull()
      .default('0.0000'),

    moneda: varchar('moneda', { length: 3 }).notNull().default('DOP'),

    // Fecha de la última actualización (sin created_by/updated_by requeridos
    // para proyecciones — solo se necesita rastrear cuándo cambiaron)
    ultimaActualizacion: timestamp('ultima_actualizacion', { withTimezone: true })
      .notNull()
      .default(sql`now()`),

    ...auditColumns,
  },
  (t) => ({
    // UPSERT target: un solo registro por tenant+partida
    tenantPartidaUniq: uniqueIndex('ep_tenant_partida_unique').on(
      t.tenantId,
      t.partidaId,
    ),
  }),
);

export type EjecucionPartidaInsert = typeof ejecucionPartidas.$inferInsert;
export type EjecucionPartidaSelect = typeof ejecucionPartidas.$inferSelect;
