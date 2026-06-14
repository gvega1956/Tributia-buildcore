import {
  pgTable,
  uuid,
  varchar,
  boolean,
  text,
  jsonb,
  integer,
  index,
} from 'drizzle-orm/pg-core';
import { newId } from '@tributia/shared';
import type { ConfiguracionRegla } from '@tributia/contabilidad';
import { tenants } from '../core/tenant.js';
import { empresas } from '../core/tenant.js';
import { auditColumns } from '../core/audit.js';

/**
 * regla_contable — motor de reglas contables (P4).
 *
 * Cada tipo_evento puede tener una o más reglas (prioridad para selección).
 * La configuracion JSONB especifica qué cuentas débito/crédito usar.
 * Los montos los calcula el handler a partir del payload del evento.
 *
 * Estructura de configuracion:
 * {
 *   "lineas": [
 *     { "tipo": "debito",  "cuentaCodigo": "5101",    "descripcion": "Costo de obra en proceso" },
 *     { "tipo": "credito", "cuentaCodigo": "1104.01", "descripcion": "Inventario de materiales" }
 *   ]
 * }
 *
 * Con RLS: cada empresa gestiona sus propias reglas.
 */
export const reglasContables = pgTable(
  'regla_contable',
  {
    id: uuid('id').primaryKey().$defaultFn(() => newId()),

    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),

    empresaId: uuid('empresa_id')
      .notNull()
      .references(() => empresas.id),

    tipoEvento: varchar('tipo_evento', { length: 50 }).notNull(),

    nombre: varchar('nombre', { length: 200 }).notNull(),

    descripcion: text('descripcion'),

    activo: boolean('activo').notNull().default(true),

    // JSONB tipado como ConfiguracionRegla.
    configuracion: jsonb('configuracion').notNull().$type<ConfiguracionRegla>(),

    // Prioridad: si hay varias reglas para el mismo tipo_evento, se usa la de menor valor.
    prioridad: integer('prioridad').notNull().default(0),

    ...auditColumns,
  },
  (t) => ({
    tenantTipoIdx: index('regla_tenant_tipo_idx').on(t.tenantId, t.tipoEvento),
  }),
);

export type ReglaContableInsert = typeof reglasContables.$inferInsert;
export type ReglaContableSelect = typeof reglasContables.$inferSelect;
