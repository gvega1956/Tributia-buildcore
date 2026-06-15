import {
  pgTable,
  uuid,
  varchar,
  text,
  numeric,
  boolean,
  index,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { newId } from '@tributia/shared';
import { tenants } from '../core/tenant.js';
import { ordenCambios } from './orden_cambio.js';
import { partidas } from '../proyectos/partida.js';
import { auditColumns } from '../core/audit.js';

export const TIPOS_IMPACTO_OC = ['COSTO', 'PLAZO', 'COSTO_Y_PLAZO'] as const;
export type TipoImpactoOC = (typeof TIPOS_IMPACTO_OC)[number];

/**
 * linea_orden_cambio — desglose de impacto por partida de una OC.
 *
 * partida_id puede ser NULL cuando es_partida_nueva=true (trabajo nuevo
 * que aún no tiene partida en la EDT; debe crearse la partida antes de
 * emitir el evento).
 *
 * monto_adicional: impacto económico de esta línea.
 * cantidad_adicional: unidades físicas adicionales (para actualizar vigente).
 */
export const lineasOrdenCambio = pgTable(
  'linea_orden_cambio',
  {
    id: uuid('id').primaryKey().$defaultFn(() => newId()),

    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),

    ordenCambioId: uuid('orden_cambio_id')
      .notNull()
      .references(() => ordenCambios.id),

    // null cuando es_partida_nueva = true (trabajo sin EDT todavía)
    partidaId: uuid('partida_id').references(() => partidas.id),

    descripcion: text('descripcion').notNull(),

    esPartidaNueva: boolean('es_partida_nueva').notNull().default(false),

    // Cantidad física adicional (misma unidad que la partida)
    cantidadAdicional: numeric('cantidad_adicional', { precision: 18, scale: 4 }),

    // Impacto económico — NUMERIC(18,4) nunca float
    montoAdicional: numeric('monto_adicional', { precision: 18, scale: 4 })
      .notNull(),

    tipoImpacto: varchar('tipo_impacto', { length: 20 })
      .notNull()
      .default('COSTO')
      .$type<TipoImpactoOC>(),

    ...auditColumns,
  },
  (t) => ({
    tenantIdx: index('loc_tenant_id_idx').on(t.tenantId),
    ordenCambioIdx: index('loc_orden_cambio_id_idx').on(t.ordenCambioId),
    tipoImpactoCheck: check(
      'loc_tipo_impacto_check',
      sql`${t.tipoImpacto} IN ('COSTO','PLAZO','COSTO_Y_PLAZO')`,
    ),
  }),
);

export type LineaOrdenCambioInsert = typeof lineasOrdenCambio.$inferInsert;
export type LineaOrdenCambioSelect = typeof lineasOrdenCambio.$inferSelect;
