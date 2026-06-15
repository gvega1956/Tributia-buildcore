import {
  pgTable,
  uuid,
  varchar,
  numeric,
  text,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { newId } from '@tributia/shared';
import { tenants } from '../core/tenant.js';
import { partesDiario } from './parte_diario.js';
import { partidas } from '../proyectos/partida.js';
import { auditColumns } from '../core/audit.js';

/**
 * avance_obra — medición de avance físico por partida en el parte diario.
 *
 * El avance se mide SIEMPRE en unidades de cantidad (m³, m², ml, unidades, etc.).
 * NUNCA como porcentaje de opinión.
 *
 * El % de avance acumulado se calcula en vivo:
 *   % = SUM(cantidad_ejecutada) / partida.cantidad_presupuestada * 100
 *
 * Si la cantidad acumulada supera cantidad_presupuestada, el handler genera
 * alerta en outbox (no bloquea). Protege el diferenciador arquitectónico P5.
 */
export const avancesObra = pgTable(
  'avance_obra',
  {
    id: uuid('id').primaryKey().$defaultFn(() => newId()),

    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),

    parteId: uuid('parte_id')
      .notNull()
      .references(() => partesDiario.id),

    partidaId: uuid('partida_id')
      .notNull()
      .references(() => partidas.id),

    cantidadEjecutada: numeric('cantidad_ejecutada', { precision: 18, scale: 4 }).notNull(),

    unidad: varchar('unidad', { length: 50 }).notNull(),

    observaciones: text('observaciones'),

    eventoId: uuid('evento_id'),

    idempotencyKey: varchar('idempotency_key', { length: 100 }).notNull(),

    ...auditColumns,
  },
  (t) => ({
    tenantIdx: index('avance_obra_tenant_idx').on(t.tenantId),
    parteIdx: index('avance_obra_parte_idx').on(t.parteId),
    partidaIdx: index('avance_obra_partida_idx').on(t.tenantId, t.partidaId),
    idempotencyUniq: uniqueIndex('avance_obra_idempotency_unique').on(t.tenantId, t.idempotencyKey),
  }),
);

export type AvanceObraInsert = typeof avancesObra.$inferInsert;
export type AvanceObraSelect = typeof avancesObra.$inferSelect;
