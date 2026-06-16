import {
  pgTable, uuid, smallint, varchar, text, boolean, integer, timestamp, index, uniqueIndex,
} from 'drizzle-orm/pg-core';
import { newId } from '@tributia/shared';
import { tenants, empresas } from '../core/tenant.js';
import { auditColumns } from '../core/audit.js';

/**
 * checklist_cierre — ítems de verificación por empresa y período.
 *
 * Los ítems con requerido=true deben estar completados antes de poder cerrar
 * el período correspondiente. Los ítems son period-specific (anio, mes).
 */
export const checklistCierre = pgTable('checklist_cierre', {
  id:            uuid('id').primaryKey().$defaultFn(() => newId()),
  tenantId:      uuid('tenant_id').notNull().references(() => tenants.id),
  empresaId:     uuid('empresa_id').notNull().references(() => empresas.id),
  anio:          smallint('anio').notNull(),
  mes:           smallint('mes').notNull(),
  nombre:        varchar('nombre', { length: 200 }).notNull(),
  descripcion:   text('descripcion'),
  requerido:     boolean('requerido').notNull().default(true),
  completado:    boolean('completado').notNull().default(false),
  completadoPor: uuid('completado_por'),
  completadoEn:  timestamp('completado_en', { withTimezone: true }),
  orden:         integer('orden').notNull().default(0),
  ...auditColumns,
}, (t) => ({
  tenantIdx:          index('checklist_tenant_idx').on(t.tenantId),
  empresaIdx:         index('checklist_empresa_idx').on(t.empresaId, t.anio, t.mes),
  itemUniqueIdx:      uniqueIndex('checklist_empresa_periodo_nombre_unique').on(t.empresaId, t.anio, t.mes, t.nombre),
}));

export type ChecklistCierreInsert = typeof checklistCierre.$inferInsert;
export type ChecklistCierreSelect = typeof checklistCierre.$inferSelect;
