import {
  pgTable,
  uuid,
  numeric,
  varchar,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { newId } from '@tributia/shared';
import { tenants } from '../core/tenant.js';
import { almacenes } from './almacen.js';
import { insumos } from '../catalogos/insumo.js';
import { auditColumns } from '../core/audit.js';

/**
 * stock_almacen — proyección de stock actual por (almacen, insumo).
 *
 * Tabla mutable (proyección síncrona del event ledger). Actualizada por los
 * handlers de recepcion_material, consumo_material, transferencia_almacen y
 * ajuste_inventario, todos síncronos dentro de la misma transacción del evento.
 *
 * costo_promedio_ponderado: WAC actualizado en cada recepción e impactado en los
 * movimientos de consumo y transferencia.
 */
export const stockAlmacen = pgTable(
  'stock_almacen',
  {
    id: uuid('id').primaryKey().$defaultFn(() => newId()),

    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),

    almacenId: uuid('almacen_id')
      .notNull()
      .references(() => almacenes.id),

    insumoId: uuid('insumo_id')
      .notNull()
      .references(() => insumos.id),

    cantidad: numeric('cantidad', { precision: 18, scale: 4 }).notNull().default('0.0000'),
    costoPorUnitario: numeric('costo_promedio_ponderado', { precision: 18, scale: 4 })
      .notNull()
      .default('0.0000'),
    moneda: varchar('moneda', { length: 3 }).notNull().default('DOP'),

    ...auditColumns,
  },
  (t) => ({
    tenantIdx: index('stock_almacen_tenant_idx').on(t.tenantId),
    almacenInsumoUniq: uniqueIndex('stock_almacen_almacen_insumo_unique').on(
      t.almacenId,
      t.insumoId,
    ),
  }),
);

export type StockAlmacenInsert = typeof stockAlmacen.$inferInsert;
export type StockAlmacenSelect = typeof stockAlmacen.$inferSelect;
