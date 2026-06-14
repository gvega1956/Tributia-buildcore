import {
  pgTable,
  uuid,
  varchar,
  integer,
  timestamp,
  index,
  unique,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { newId } from '@tributia/shared';
import { tenants } from '../core/tenant.js';

/**
 * proyeccion_ledger_stats — proyección de ejemplo para validar el motor (Sesión 6).
 *
 * Registra el conteo de eventos por (tenant, tipo_evento).
 * El ContadorSincronoHandler (sincrono) y el NotificacionAsincronaHandler (asíncrono)
 * escriben aquí mediante UPSERT — lo que hace ambos handlers idempotentes.
 *
 * Con RLS: solo el tenant del contexto puede ver sus propias estadísticas.
 */
export const proyeccionLedgerStats = pgTable(
  'proyeccion_ledger_stats',
  {
    id: uuid('id').primaryKey().$defaultFn(() => newId()),

    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),

    tipoEvento: varchar('tipo_evento', { length: 50 }).notNull(),

    totalEventos: integer('total_eventos').notNull().default(0),

    ultimaActualizacion: timestamp('ultima_actualizacion', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    tenantTipoUniq: unique('stats_tenant_tipo_unique').on(t.tenantId, t.tipoEvento),
    tenantIdx: index('stats_tenant_id_idx').on(t.tenantId),
  }),
);

export type ProyeccionLedgerStatsInsert = typeof proyeccionLedgerStats.$inferInsert;
export type ProyeccionLedgerStatsSelect = typeof proyeccionLedgerStats.$inferSelect;
