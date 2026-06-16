import { pgTable, uuid, varchar, numeric, date, index, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { newId } from '@tributia/shared';
import { tenants, empresas } from '../core/tenant.js';
import { proyectos } from '../proyectos/proyecto.js';
import { terceros } from '../catalogos/tercero.js';
import { facturasCliente } from './factura_cliente.js';
import { eventosOperativos } from '../ledger/evento_operativo.js';
import { asientosContables } from '../contabilidad/asiento_contable.js';
import { auditColumns } from '../core/audit.js';

export const ESTADOS_CXC = ['PENDIENTE', 'PAGADA_PARCIAL', 'PAGADA_TOTAL', 'ANULADA'] as const;
export type EstadoCxc = (typeof ESTADOS_CXC)[number];

/**
 * cuenta_por_cobrar — activo contable que nace automáticamente del evento
 * emision_factura_cliente. No se digita: el ledger la crea (P2).
 *
 * proyectoId existe aquí (a diferencia de cuenta_por_pagar) porque el aging
 * de CxC se pide explícitamente por cliente Y por proyecto (§16).
 */
export const cuentasPorCobrar = pgTable(
  'cuenta_por_cobrar',
  {
    id: uuid('id').primaryKey().$defaultFn(() => newId()),

    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),

    empresaId: uuid('empresa_id')
      .notNull()
      .references(() => empresas.id),

    proyectoId: uuid('proyecto_id')
      .notNull()
      .references(() => proyectos.id),

    facturaClienteId: uuid('factura_cliente_id')
      .notNull()
      .references(() => facturasCliente.id),

    terceroId: uuid('tercero_id')
      .notNull()
      .references(() => terceros.id),

    // Monto neto a cobrar (después de retenciones del cliente) — lo que efectivamente cobraremos
    montoOriginal: numeric('monto_original', { precision: 18, scale: 4 }).notNull(),
    montoCobrado: numeric('monto_cobrado', { precision: 18, scale: 4 })
      .notNull()
      .default('0.0000'),
    moneda: varchar('moneda', { length: 3 }).notNull().default('DOP'),

    fechaEmision: date('fecha_emision').notNull(),
    fechaVencimiento: date('fecha_vencimiento'),

    estado: varchar('estado', { length: 20 })
      .notNull()
      .default('PENDIENTE')
      .$type<EstadoCxc>(),

    // FK al evento del ledger que la originó
    eventoOrigenId: uuid('evento_origen_id')
      .notNull()
      .references(() => eventosOperativos.id),

    // FK al asiento contable generado junto con la CxC
    asientoId: uuid('asiento_id').references(() => asientosContables.id),

    ...auditColumns,
  },
  (t) => ({
    tenantIdx: index('cxc_tenant_id_idx').on(t.tenantId),
    terceroIdx: index('cxc_tercero_id_idx').on(t.terceroId),
    proyectoIdx: index('cxc_proyecto_id_idx').on(t.proyectoId),
    estadoCheck: check(
      'cxc_estado_check',
      sql`${t.estado} IN ('PENDIENTE','PAGADA_PARCIAL','PAGADA_TOTAL','ANULADA')`,
    ),
  }),
);

export type CuentaPorCobrarInsert = typeof cuentasPorCobrar.$inferInsert;
export type CuentaPorCobrarSelect = typeof cuentasPorCobrar.$inferSelect;
