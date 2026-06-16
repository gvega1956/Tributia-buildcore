import {
  pgTable, uuid, varchar, numeric, date, index, uniqueIndex, check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { newId } from '@tributia/shared';
import { tenants } from '../core/tenant.js';
import { auditColumns } from '../core/audit.js';

/**
 * tasa_cambio — histórico de tasas de cambio con granularidad diaria.
 *
 * La tasa se registra EN el payload del evento al momento de su ocurrencia.
 * Esta tabla es la fuente de consulta en el momento de registro, no después.
 * UNIQUE (tenant_id, moneda_origen, moneda_destino, fecha).
 */
export const tasasCambio = pgTable('tasa_cambio', {
  id:             uuid('id').primaryKey().$defaultFn(() => newId()),
  tenantId:       uuid('tenant_id').notNull().references(() => tenants.id),
  monedaOrigen:   varchar('moneda_origen', { length: 3 }).notNull(),
  monedaDestino:  varchar('moneda_destino', { length: 3 }).notNull(),
  tasa:           numeric('tasa', { precision: 18, scale: 6 }).notNull(),
  fecha:          date('fecha').notNull(),
  fuente:         varchar('fuente', { length: 100 }),
  ...auditColumns,
}, (t) => ({
  tenantFechaIdx: index('tasa_cambio_tenant_fecha_idx').on(t.tenantId, t.monedaOrigen, t.monedaDestino, t.fecha),
  tasaUniqueIdx:  uniqueIndex('tasa_cambio_unique').on(t.tenantId, t.monedaOrigen, t.monedaDestino, t.fecha),
  tasaPositiva:   check('tasa_positiva', sql`${t.tasa} > 0`),
}));

export type TasaCambioInsert = typeof tasasCambio.$inferInsert;
export type TasaCambioSelect = typeof tasasCambio.$inferSelect;
