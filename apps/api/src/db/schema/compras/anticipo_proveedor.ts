import {
  pgTable,
  uuid,
  varchar,
  numeric,
  date,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { newId } from '@tributia/shared';
import { tenants, empresas } from '../core/tenant.js';
import { terceros } from '../catalogos/tercero.js';
import { ordenesCompra } from './orden_compra.js';
import { cuentasPorPagar } from './cuenta_por_pagar.js';
import { auditColumns } from '../core/audit.js';

export const ESTADOS_ANTICIPO = [
  'PENDIENTE',
  'AMORTIZADO_PARCIAL',
  'AMORTIZADO_TOTAL',
  'ANULADO',
] as const;
export type EstadoAnticipo = (typeof ESTADOS_ANTICIPO)[number];

/**
 * anticipo_proveedor — pago anticipado antes de recibir materiales.
 *
 * Se amortiza contra la CxP generada por recepcion_factura_proveedor.
 * Cuando montoAmortizado = montoAnticipo → estado AMORTIZADO_TOTAL.
 */
export const anticiposProveedor = pgTable(
  'anticipo_proveedor',
  {
    id: uuid('id').primaryKey().$defaultFn(() => newId()),

    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),

    empresaId: uuid('empresa_id')
      .notNull()
      .references(() => empresas.id),

    terceroId: uuid('tercero_id')
      .notNull()
      .references(() => terceros.id),

    // OC a la que está asociado el anticipo (puede ser null para anticipos generales)
    ordenCompraId: uuid('orden_compra_id').references(() => ordenesCompra.id),

    numero: varchar('numero', { length: 30 }).notNull(),

    montoAnticipo: numeric('monto_anticipo', { precision: 18, scale: 4 }).notNull(),
    montoAmortizado: numeric('monto_amortizado', { precision: 18, scale: 4 })
      .notNull()
      .default('0.0000'),
    moneda: varchar('moneda', { length: 3 }).notNull().default('DOP'),

    fechaPago: date('fecha_pago').notNull(),

    estado: varchar('estado', { length: 25 })
      .notNull()
      .default('PENDIENTE')
      .$type<EstadoAnticipo>(),

    // Última CxP contra la que se aplicó una amortización
    cuentaPorPagarAplicadaId: uuid('cuenta_por_pagar_aplicada_id').references(
      () => cuentasPorPagar.id,
    ),

    ...auditColumns,
  },
  (t) => ({
    tenantIdx: index('anticipo_prov_tenant_idx').on(t.tenantId),
    terceroIdx: index('anticipo_prov_tercero_idx').on(t.terceroId),
    numeroUniq: uniqueIndex('anticipo_prov_tenant_numero_unique').on(t.tenantId, t.numero),
    estadoCheck: check(
      'anticipo_prov_estado_check',
      sql`${t.estado} IN ('PENDIENTE','AMORTIZADO_PARCIAL','AMORTIZADO_TOTAL','ANULADO')`,
    ),
  }),
);

export type AnticipoProveedorInsert = typeof anticiposProveedor.$inferInsert;
export type AnticipoProveedorSelect = typeof anticiposProveedor.$inferSelect;
