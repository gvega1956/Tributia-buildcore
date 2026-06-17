import { pgTable, uuid, varchar, numeric, date, index, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { newId } from '@tributia/shared';
import { tenants } from '../core/tenant.js';
import { partidas } from '../proyectos/partida.js';
import { terceros } from '../catalogos/tercero.js';
import { eventosOperativos } from '../ledger/evento_operativo.js';
import { asientosContables } from '../contabilidad/asiento_contable.js';
import { fondosCajaChica } from './fondo_caja_chica.js';
import { auditColumns } from '../core/audit.js';

export const TIPOS_COMPROBANTE_GASTO = ['FACTURA', 'RECIBO', 'NCF', 'OTRO'] as const;
export type TipoComprobanteGasto = (typeof TIPOS_COMPROBANTE_GASTO)[number];

/**
 * gasto_caja_chica — gasto documentado contra un fondo de caja chica de
 * obra. Nace del evento gasto_caja_chica (P2): no se digita el saldo del
 * fondo directamente, lo reduce el handler de proyección.
 *
 * `numeroComprobante` + `tipoComprobante` son el "documentado con
 * comprobante" del prompt — sin ellos no hay forma de auditar para qué se
 * usó el efectivo. `partidaId` es opcional porque algunos gastos de caja
 * chica son administrativos de la obra (ej. agua para los trabajadores) y
 * no se imputan a una partida específica del presupuesto.
 */
export const gastosCajaChica = pgTable(
  'gasto_caja_chica',
  {
    id: uuid('id').primaryKey().$defaultFn(() => newId()),

    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),

    fondoId: uuid('fondo_id')
      .notNull()
      .references(() => fondosCajaChica.id),

    fecha: date('fecha').notNull(),
    monto: numeric('monto', { precision: 18, scale: 4 }).notNull(),
    moneda: varchar('moneda', { length: 3 }).notNull().default('DOP'),
    concepto: varchar('concepto', { length: 500 }).notNull(),

    numeroComprobante: varchar('numero_comprobante', { length: 50 }).notNull(),
    tipoComprobante: varchar('tipo_comprobante', { length: 20 })
      .notNull()
      .$type<TipoComprobanteGasto>(),

    proveedorTerceroId: uuid('proveedor_tercero_id').references(() => terceros.id),
    partidaId: uuid('partida_id').references(() => partidas.id),

    eventoOrigenId: uuid('evento_origen_id')
      .notNull()
      .references(() => eventosOperativos.id),
    asientoId: uuid('asiento_id').references(() => asientosContables.id),

    ...auditColumns,
  },
  (t) => ({
    tenantIdx: index('gasto_caja_chica_tenant_idx').on(t.tenantId),
    fondoIdx: index('gasto_caja_chica_fondo_idx').on(t.fondoId),
    tipoComprobanteCheck: check(
      'gasto_caja_chica_tipo_comprobante_check',
      sql`${t.tipoComprobante} IN ('FACTURA','RECIBO','NCF','OTRO')`,
    ),
  }),
);

export type GastoCajaChicaInsert = typeof gastosCajaChica.$inferInsert;
export type GastoCajaChicaSelect = typeof gastosCajaChica.$inferSelect;
