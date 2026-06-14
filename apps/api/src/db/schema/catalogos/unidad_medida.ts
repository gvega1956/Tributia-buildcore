import {
  pgTable,
  uuid,
  varchar,
  boolean,
  text,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { newId } from '@tributia/shared';
import { tenants } from '../core/tenant.js';
import { auditColumns } from '../core/audit.js';

/**
 * unidad_medida — catálogo de unidades de medida por tenant.
 * Estándar (KG, M3, M2, ML, UN, GL…) pre-cargado por seed; customizable.
 * Con RLS: cada tenant gestiona su propio catálogo.
 */
export const unidadesMedida = pgTable(
  'unidad_medida',
  {
    id: uuid('id').primaryKey().$defaultFn(() => newId()),

    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),

    codigo: varchar('codigo', { length: 10 }).notNull(),
    nombre: varchar('nombre', { length: 80 }).notNull(),
    descripcion: text('descripcion'),
    activo: boolean('activo').notNull().default(true),

    ...auditColumns,
  },
  (t) => ({
    tenantIdx: index('unidad_tenant_idx').on(t.tenantId),
    tenantCodigoUniq: uniqueIndex('unidad_tenant_codigo_unique').on(t.tenantId, t.codigo),
  }),
);

export type UnidadMedidaInsert = typeof unidadesMedida.$inferInsert;
export type UnidadMedidaSelect = typeof unidadesMedida.$inferSelect;
