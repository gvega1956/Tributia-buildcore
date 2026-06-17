import { pgTable, uuid, varchar, numeric, date, integer, text, index, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { newId } from '@tributia/shared';
import { tenants, empresas } from '../core/tenant.js';
import { cuentasPorPagar } from '../compras/cuenta_por_pagar.js';
import { cuentasBancarias } from './cuenta_bancaria.js';
import { eventosOperativos } from '../ledger/evento_operativo.js';
import { auditColumns } from '../core/audit.js';

export const ESTADOS_PROGRAMACION_PAGO = ['PROGRAMADO', 'EN_ESPERA', 'EMITIDO', 'CANCELADO'] as const;
export type EstadoProgramacionPago = (typeof ESTADOS_PROGRAMACION_PAGO)[number];

/**
 * programacion_pago — cola de pagos a proveedores/subcontratistas
 * ordenada por prioridad (menor número = mayor prioridad) y caja
 * disponible (§16). ProgramacionPagoService.ejecutarLote() recorre la cola
 * en orden de prioridad y solo emite pago_emitido para los que la cuenta
 * bancaria puede cubrir; los que no alcanzan quedan en EN_ESPERA (nunca se
 * emite un pago sin fondos, por diseño explícito del prompt de Sesión 5).
 */
export const programacionesPago = pgTable(
  'programacion_pago',
  {
    id: uuid('id').primaryKey().$defaultFn(() => newId()),

    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),

    empresaId: uuid('empresa_id')
      .notNull()
      .references(() => empresas.id),

    cuentaPorPagarId: uuid('cuenta_por_pagar_id')
      .notNull()
      .references(() => cuentasPorPagar.id),

    cuentaBancariaId: uuid('cuenta_bancaria_id')
      .notNull()
      .references(() => cuentasBancarias.id),

    // Imputación del pago (P3): al menos uno debe ser no nulo.
    proyectoId: uuid('proyecto_id'),
    centroCostoId: uuid('centro_costo_id'),

    monto: numeric('monto', { precision: 18, scale: 4 }).notNull(),
    moneda: varchar('moneda', { length: 3 }).notNull().default('DOP'),
    fechaProgramada: date('fecha_programada').notNull(),
    prioridad: integer('prioridad').notNull().default(100),

    estado: varchar('estado', { length: 20 })
      .notNull()
      .default('PROGRAMADO')
      .$type<EstadoProgramacionPago>(),

    motivoEspera: text('motivo_espera'),

    eventoOrigenId: uuid('evento_origen_id').references(() => eventosOperativos.id),

    ...auditColumns,
  },
  (t) => ({
    tenantIdx: index('programacion_pago_tenant_idx').on(t.tenantId),
    cuentaBancariaIdx: index('programacion_pago_cuenta_bancaria_idx').on(t.cuentaBancariaId),
    estadoPrioridadIdx: index('programacion_pago_estado_prioridad_idx').on(t.estado, t.prioridad),
    estadoCheck: check(
      'programacion_pago_estado_check',
      sql`${t.estado} IN ('PROGRAMADO','EN_ESPERA','EMITIDO','CANCELADO')`,
    ),
  }),
);

export type ProgramacionPagoInsert = typeof programacionesPago.$inferInsert;
export type ProgramacionPagoSelect = typeof programacionesPago.$inferSelect;
