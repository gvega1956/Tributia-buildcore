import {
  pgTable,
  uuid,
  numeric,
  varchar,
  timestamp,
  index,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { newId } from '@tributia/shared';
import { tenants } from '../core/tenant.js';
import { almacenes } from './almacen.js';
import { insumos } from '../catalogos/insumo.js';
import { eventosOperativos } from '../ledger/evento_operativo.js';

export const TIPOS_MOVIMIENTO = [
  'ENTRADA',
  'SALIDA',
  'TRANSFERENCIA_SALIDA',
  'TRANSFERENCIA_ENTRADA',
  'AJUSTE_ENTRADA',
  'AJUSTE_SALIDA',
] as const;
export type TipoMovimientoInventario = (typeof TIPOS_MOVIMIENTO)[number];

/**
 * movimiento_inventario — registro inmutable de cada movimiento de stock.
 *
 * Append-only: el rol tributia_app no tiene DELETE. Es la proyección
 * auditada del event ledger para inventario. Todo movimiento referencia
 * su evento_operativo de origen.
 */
export const movimientosInventario = pgTable(
  'movimiento_inventario',
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

    tipoMovimiento: varchar('tipo_movimiento', { length: 30 })
      .notNull()
      .$type<TipoMovimientoInventario>(),

    cantidad: numeric('cantidad', { precision: 18, scale: 4 }).notNull(),
    costoUnitario: numeric('costo_unitario', { precision: 18, scale: 4 }).notNull(),
    costoTotal: numeric('costo_total', { precision: 18, scale: 4 }).notNull(),
    moneda: varchar('moneda', { length: 3 }).notNull(),

    eventoOperativoId: uuid('evento_operativo_id')
      .notNull()
      .references(() => eventosOperativos.id),

    partidaId: uuid('partida_id'),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    createdBy: uuid('created_by').notNull(),
  },
  (t) => ({
    tenantIdx: index('movimiento_inv_tenant_idx').on(t.tenantId),
    almacenIdx: index('movimiento_inv_almacen_idx').on(t.almacenId),
    insumoIdx: index('movimiento_inv_insumo_idx').on(t.insumoId),
    eventoIdx: index('movimiento_inv_evento_idx').on(t.eventoOperativoId),
    tipoCheck: check(
      'movimiento_inv_tipo_check',
      sql`${t.tipoMovimiento} IN ('ENTRADA','SALIDA','TRANSFERENCIA_SALIDA','TRANSFERENCIA_ENTRADA','AJUSTE_ENTRADA','AJUSTE_SALIDA')`,
    ),
  }),
);

export type MovimientoInventarioInsert = typeof movimientosInventario.$inferInsert;
export type MovimientoInventarioSelect = typeof movimientosInventario.$inferSelect;
