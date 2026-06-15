import {
  pgTable,
  uuid,
  varchar,
  numeric,
  date,
  index,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { newId } from '@tributia/shared';
import { tenants, empresas } from '../core/tenant.js';
import { terceros } from '../catalogos/tercero.js';
import { facturasProveedor } from './factura_proveedor.js';
import { eventosOperativos } from '../ledger/evento_operativo.js';
import { asientosContables } from '../contabilidad/asiento_contable.js';
import { auditColumns } from '../core/audit.js';

export const ESTADOS_CXP = ['PENDIENTE', 'PAGADA_PARCIAL', 'PAGADA_TOTAL', 'ANULADA'] as const;
export type EstadoCxp = (typeof ESTADOS_CXP)[number];

/**
 * cuenta_por_pagar — pasivo contable que nace automáticamente del evento
 * recepcion_factura_proveedor. No se digita: el ledger la crea.
 *
 * P2 (Event Ledger): la CxP es una proyección del evento, no un documento manual.
 */
export const cuentasPorPagar = pgTable(
  'cuenta_por_pagar',
  {
    id: uuid('id').primaryKey().$defaultFn(() => newId()),

    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),

    empresaId: uuid('empresa_id')
      .notNull()
      .references(() => empresas.id),

    // Factura que originó esta CxP
    facturaProveedorId: uuid('factura_proveedor_id')
      .notNull()
      .references(() => facturasProveedor.id),

    terceroId: uuid('tercero_id')
      .notNull()
      .references(() => terceros.id),

    montoOriginal: numeric('monto_original', { precision: 18, scale: 4 }).notNull(),
    montoPagado: numeric('monto_pagado', { precision: 18, scale: 4 })
      .notNull()
      .default('0.0000'),
    moneda: varchar('moneda', { length: 3 }).notNull().default('DOP'),

    fechaVencimiento: date('fecha_vencimiento'),

    estado: varchar('estado', { length: 20 })
      .notNull()
      .default('PENDIENTE')
      .$type<EstadoCxp>(),

    // FK al evento del ledger que la originó
    eventoOrigenId: uuid('evento_origen_id')
      .notNull()
      .references(() => eventosOperativos.id),

    // FK al asiento contable generado junto con la CxP
    asientoId: uuid('asiento_id').references(() => asientosContables.id),

    ...auditColumns,
  },
  (t) => ({
    tenantIdx: index('cxp_tenant_id_idx').on(t.tenantId),
    terceroIdx: index('cxp_tercero_id_idx').on(t.terceroId),
    estadoCheck: check(
      'cxp_estado_check',
      sql`${t.estado} IN ('PENDIENTE','PAGADA_PARCIAL','PAGADA_TOTAL','ANULADA')`,
    ),
  }),
);

export type CuentaPorPagarInsert = typeof cuentasPorPagar.$inferInsert;
export type CuentaPorPagarSelect = typeof cuentasPorPagar.$inferSelect;
