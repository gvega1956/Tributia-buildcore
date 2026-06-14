import {
  pgTable,
  uuid,
  varchar,
  numeric,
  index,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { newId } from '@tributia/shared';
import type { TipoLinea } from '@tributia/contabilidad';
import { tenants } from '../core/tenant.js';
import { asientosContables } from './asiento_contable.js';
import { cuentasContables } from './cuenta_contable.js';

/**
 * linea_asiento — cada débito o crédito del asiento de partida doble.
 *
 * Reglas de integridad:
 *   - importe siempre positivo; el tipo ('debe'/'haber') determina si es débito o crédito.
 *   - Sin columnas de auditoría (inmutables: forman parte del asiento contable).
 *   - tenant_id desnormalizado para RLS consistente con el resto del esquema.
 *
 * La validación Σdebe = Σhaber se hace en AsientoContableService antes de insertar.
 * La función contabilidad_verificar_balance(asiento_id) verifica esto a nivel BD (tests).
 */
export const lineasAsiento = pgTable(
  'linea_asiento',
  {
    id: uuid('id').primaryKey().$defaultFn(() => newId()),

    // Desnormalizado para RLS (misma política que asiento_contable).
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),

    asientoId: uuid('asiento_id')
      .notNull()
      .references(() => asientosContables.id),

    cuentaId: uuid('cuenta_id')
      .notNull()
      .references(() => cuentasContables.id),

    tipo: varchar('tipo', { length: 5 }).notNull().$type<TipoLinea>(),

    // NUMERIC(18,4) — siempre positivo.
    importe: numeric('importe', { precision: 18, scale: 4 }).notNull(),

    moneda: varchar('moneda', { length: 3 }).notNull().default('DOP'),

    descripcion: varchar('descripcion', { length: 300 }),
  },
  (t) => ({
    asientoIdx: index('linea_asiento_id_idx').on(t.asientoId),
    tenantIdx: index('linea_tenant_id_idx').on(t.tenantId),
    tipoCheck: check('linea_tipo_check', sql`${t.tipo} IN ('debe','haber')`),
    importeCheck: check('linea_importe_positivo', sql`${t.importe} > 0`),
  }),
);

export type LineaAsientoInsert = typeof lineasAsiento.$inferInsert;
export type LineaAsientoSelect = typeof lineasAsiento.$inferSelect;
