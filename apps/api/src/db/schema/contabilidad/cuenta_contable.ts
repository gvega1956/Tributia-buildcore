import {
  pgTable,
  uuid,
  varchar,
  boolean,
  integer,
  index,
  unique,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { newId } from '@tributia/shared';
import type { TipoCuenta, NaturalezaCuenta } from '@tributia/contabilidad';
import { tenants } from '../core/tenant.js';
import { empresas } from '../core/tenant.js';
import { auditColumns } from '../core/audit.js';

/**
 * cuenta_contable — plan de cuentas jerárquico por empresa (P4).
 *
 * Plantilla RD pre-cargada via seed-plan-cuentas-rd.ts.
 * Cada empresa puede personalizar su plan sin afectar a otras.
 *
 * Niveles:
 *   1 = grupo        (1 Activos, 2 Pasivos, 3 Patrimonio, 4 Ingresos, 5 Costos/Gastos)
 *   2 = subgrupo     (11 Activos Corrientes, 51 Costos de Contratos...)
 *   3 = cuenta       (1104 Inventarios, 5101 Costo de Obra en Proceso...)
 *   4 = subcuenta    (1104.01 Inventario de Materiales...)
 *
 * Solo cuentas con es_movimiento=true admiten líneas de asiento.
 * Con RLS: cada empresa ve solo su propio plan.
 */
export const cuentasContables = pgTable(
  'cuenta_contable',
  {
    id: uuid('id').primaryKey().$defaultFn(() => newId()),

    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),

    empresaId: uuid('empresa_id')
      .notNull()
      .references(() => empresas.id),

    // Código del plan de cuentas: "1", "11", "1104", "1104.01"
    codigo: varchar('codigo', { length: 20 }).notNull(),

    nombre: varchar('nombre', { length: 200 }).notNull(),

    tipo: varchar('tipo', { length: 20 }).notNull().$type<TipoCuenta>(),

    // Naturaleza: deudora (aumenta con débito) o acreedora (aumenta con crédito).
    naturaleza: varchar('naturaleza', { length: 10 }).notNull().$type<NaturalezaCuenta>(),

    nivel: integer('nivel').notNull(),

    // Referencia al padre en la jerarquía (null = cuenta raíz de grupo).
    padreId: uuid('padre_id'),

    // Solo cuentas de movimiento admiten líneas de asiento.
    esMovimiento: boolean('es_movimiento').notNull().default(false),

    activo: boolean('activo').notNull().default(true),

    ...auditColumns,
  },
  (t) => ({
    tenantIdx: index('cuenta_tenant_id_idx').on(t.tenantId),
    empresaIdx: index('cuenta_empresa_id_idx').on(t.empresaId),
    empresaCodigoUniq: unique('cuenta_empresa_codigo_unique').on(t.tenantId, t.empresaId, t.codigo),
    tipoCheck: check(
      'cuenta_tipo_check',
      sql`${t.tipo} IN ('activo','pasivo','patrimonio','ingreso','costo','gasto')`,
    ),
    naturalezaCheck: check(
      'cuenta_naturaleza_check',
      sql`${t.naturaleza} IN ('deudora','acreedora')`,
    ),
  }),
);

export type CuentaContableInsert = typeof cuentasContables.$inferInsert;
export type CuentaContableSelect = typeof cuentasContables.$inferSelect;
