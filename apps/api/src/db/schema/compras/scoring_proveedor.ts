import {
  pgTable,
  uuid,
  numeric,
  integer,
  varchar,
  timestamp,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { newId } from '@tributia/shared';
import { tenants } from '../core/tenant.js';
import { terceros } from '../catalogos/tercero.js';
import { auditColumns } from '../core/audit.js';

/**
 * scoring_proveedor — proyección mutable del desempeño del proveedor.
 *
 * Actualizado automáticamente por el handler de recepcion_oc:
 *   - puntualidad: ¿llegó a tiempo vs fecha_entrega_prometida en la OC?
 *   - calidad: ¿hubo rechazos o devoluciones?
 *   - precio: ¿el precio real vs el cotizado?
 *
 * score_total = promedio ponderado (40% puntualidad, 40% calidad, 20% precio).
 * Escala 0-100 donde 100 = perfecto.
 */
export const scoringProveedor = pgTable(
  'scoring_proveedor',
  {
    id: uuid('id').primaryKey().$defaultFn(() => newId()),

    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),

    terceroId: uuid('tercero_id')
      .notNull()
      .references(() => terceros.id),

    totalOcs: integer('total_ocs').notNull().default(0),
    totalRecepciones: integer('total_recepciones').notNull().default(0),
    totalRecepcionesATiempo: integer('total_recepciones_a_tiempo').notNull().default(0),
    totalRechazos: integer('total_rechazos').notNull().default(0),
    totalDiscrepanciasPrecio: integer('total_discrepancias_precio').notNull().default(0),

    // Scores 0-100
    scorePuntualidad: numeric('score_puntualidad', { precision: 5, scale: 2 })
      .notNull()
      .default('100.00'),
    scoreCalidad: numeric('score_calidad', { precision: 5, scale: 2 })
      .notNull()
      .default('100.00'),
    scorePrecio: numeric('score_precio', { precision: 5, scale: 2 })
      .notNull()
      .default('100.00'),
    scoreTotal: numeric('score_total', { precision: 5, scale: 2 })
      .notNull()
      .default('100.00'),

    monedaBase: varchar('moneda_base', { length: 3 }).notNull().default('DOP'),

    ultimaActualizacion: timestamp('ultima_actualizacion', { withTimezone: true })
      .notNull()
      .default(sql`now()`),

    ...auditColumns,
  },
  (t) => ({
    tenantIdx: index('scoring_prov_tenant_idx').on(t.tenantId),
    tenantTerceroUniq: uniqueIndex('scoring_prov_tenant_tercero_unique').on(
      t.tenantId,
      t.terceroId,
    ),
  }),
);

export type ScoringProveedorInsert = typeof scoringProveedor.$inferInsert;
export type ScoringProveedorSelect = typeof scoringProveedor.$inferSelect;
