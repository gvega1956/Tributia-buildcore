import { pgTable, uuid, varchar, boolean, numeric, text, index } from 'drizzle-orm/pg-core';
import { newId } from '@tributia/shared';
import { tenants } from '../core/tenant.js';
import { auditColumns } from '../core/audit.js';

/**
 * tipo_flujo — plantilla de flujo de aprobación para un tipo de documento.
 *
 * Un tipo de documento puede tener múltiples tipo_flujo activos; el motor
 * selecciona el más específico según el monto del documento. Si condicion_monto_*
 * son null, el flujo aplica a cualquier monto.
 *
 * Ejemplos: 'orden_compra' con monto hasta 50,000 DOP → 1 aprobador;
 *           'orden_compra' con monto > 50,000 DOP → 2 aprobadores + gerencia.
 */
export const tiposFlujo = pgTable(
  'tipo_flujo',
  {
    id: uuid('id').primaryKey().$defaultFn(() => newId()),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),

    tipoDocumento: varchar('tipo_documento', { length: 50 }).notNull(),
    nombre: varchar('nombre', { length: 200 }).notNull(),
    descripcion: text('descripcion'),

    condicionMontoMin: numeric('condicion_monto_min', { precision: 18, scale: 4 }),
    condicionMontoMax: numeric('condicion_monto_max', { precision: 18, scale: 4 }),
    monedaCondicion: varchar('moneda_condicion', { length: 3 }),

    activo: boolean('activo').notNull().default(true),

    ...auditColumns,
  },
  (t) => ({
    tenantIdx: index('tipo_flujo_tenant_idx').on(t.tenantId),
    tipoDocIdx: index('tipo_flujo_tipo_doc_idx').on(t.tenantId, t.tipoDocumento),
  }),
);

export type TipoFlujoInsert = typeof tiposFlujo.$inferInsert;
export type TipoFlujoSelect = typeof tiposFlujo.$inferSelect;
