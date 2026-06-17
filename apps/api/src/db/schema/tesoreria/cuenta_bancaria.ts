import { pgTable, uuid, varchar, numeric, boolean, index, check, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { newId } from '@tributia/shared';
import { tenants, empresas } from '../core/tenant.js';
import { auditColumns } from '../core/audit.js';

export const TIPOS_CUENTA_BANCARIA = ['CORRIENTE', 'AHORROS'] as const;
export type TipoCuentaBancaria = (typeof TIPOS_CUENTA_BANCARIA)[number];

/**
 * cuenta_bancaria — cuenta bancaria de la empresa (§16 arquitectura.md).
 *
 * `saldoActual` es un caché mantenido transaccionalmente por BancoService
 * cada vez que se inserta un movimiento_bancario — nunca se recalcula por
 * trigger porque la conciliación necesita poder marcar diferencias sin
 * tocar el saldo contable real.
 *
 * `cuentaContableCodigo` enlaza con el plan de cuentas (1101.XX Bancos) para
 * que el motor de reglas contables sepa a qué cuenta debitar/acreditar.
 */
export const cuentasBancarias = pgTable(
  'cuenta_bancaria',
  {
    id: uuid('id').primaryKey().$defaultFn(() => newId()),

    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),

    empresaId: uuid('empresa_id')
      .notNull()
      .references(() => empresas.id),

    bancoNombre: varchar('banco_nombre', { length: 200 }).notNull(),
    numeroCuenta: varchar('numero_cuenta', { length: 50 }).notNull(),
    tipoCuenta: varchar('tipo_cuenta', { length: 20 })
      .notNull()
      .default('CORRIENTE')
      .$type<TipoCuentaBancaria>(),
    moneda: varchar('moneda', { length: 3 }).notNull().default('DOP'),
    cuentaContableCodigo: varchar('cuenta_contable_codigo', { length: 20 }).notNull(),

    saldoActual: numeric('saldo_actual', { precision: 18, scale: 4 }).notNull().default('0.0000'),

    activo: boolean('activo').notNull().default(true),

    ...auditColumns,
  },
  (t) => ({
    tenantIdx: index('cuenta_bancaria_tenant_idx').on(t.tenantId),
    empresaIdx: index('cuenta_bancaria_empresa_idx').on(t.empresaId),
    numeroUnique: uniqueIndex('cuenta_bancaria_numero_unique').on(t.tenantId, t.numeroCuenta),
    tipoCheck: check('cuenta_bancaria_tipo_check', sql`${t.tipoCuenta} IN ('CORRIENTE','AHORROS')`),
  }),
);

export type CuentaBancariaInsert = typeof cuentasBancarias.$inferInsert;
export type CuentaBancariaSelect = typeof cuentasBancarias.$inferSelect;
