import { pgTable, uuid, varchar, numeric, date, boolean, index, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { newId } from '@tributia/shared';
import { tenants, empresas } from '../core/tenant.js';
import { eventosOperativos } from '../ledger/evento_operativo.js';
import { cuentasBancarias } from './cuenta_bancaria.js';
import { auditColumns } from '../core/audit.js';

export const TIPOS_MOVIMIENTO_BANCARIO = ['DEPOSITO', 'RETIRO'] as const;
export type TipoMovimientoBancario = (typeof TIPOS_MOVIMIENTO_BANCARIO)[number];

/**
 * movimiento_bancario — registro del lado "sistema" de cada entrada/salida
 * de una cuenta bancaria. Nace de un evento del ledger (cobro_recibido,
 * pago_emitido, reposicion_caja_chica) — nunca se digita directo (P2).
 *
 * `conciliado` + `lineaExtractoId` son el lado de ConciliacionBancariaService:
 * un movimiento queda conciliado cuando hace match con una línea del
 * extracto importado.
 */
export const movimientosBancarios = pgTable(
  'movimiento_bancario',
  {
    id: uuid('id').primaryKey().$defaultFn(() => newId()),

    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),

    empresaId: uuid('empresa_id')
      .notNull()
      .references(() => empresas.id),

    cuentaBancariaId: uuid('cuenta_bancaria_id')
      .notNull()
      .references(() => cuentasBancarias.id),

    tipo: varchar('tipo', { length: 20 }).notNull().$type<TipoMovimientoBancario>(),
    monto: numeric('monto', { precision: 18, scale: 4 }).notNull(),
    moneda: varchar('moneda', { length: 3 }).notNull().default('DOP'),
    fecha: date('fecha').notNull(),
    concepto: varchar('concepto', { length: 500 }).notNull(),
    referencia: varchar('referencia', { length: 100 }),

    eventoOrigenId: uuid('evento_origen_id').references(() => eventosOperativos.id),

    conciliado: boolean('conciliado').notNull().default(false),
    lineaExtractoId: uuid('linea_extracto_id'),

    ...auditColumns,
  },
  (t) => ({
    tenantIdx: index('mov_bancario_tenant_idx').on(t.tenantId),
    cuentaIdx: index('mov_bancario_cuenta_idx').on(t.cuentaBancariaId),
    fechaIdx: index('mov_bancario_fecha_idx').on(t.fecha),
    conciliadoIdx: index('mov_bancario_conciliado_idx').on(t.cuentaBancariaId, t.conciliado),
    tipoCheck: check('mov_bancario_tipo_check', sql`${t.tipo} IN ('DEPOSITO','RETIRO')`),
  }),
);

export type MovimientoBancarioInsert = typeof movimientosBancarios.$inferInsert;
export type MovimientoBancarioSelect = typeof movimientosBancarios.$inferSelect;
