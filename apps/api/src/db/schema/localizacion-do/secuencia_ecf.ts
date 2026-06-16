import { pgTable, uuid, varchar, integer, uniqueIndex, index, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { newId } from '@tributia/shared';
import { tenants, empresas } from '../core/tenant.js';
import { auditColumns } from '../core/audit.js';

/**
 * secuencia_ecf — siguiente número de NCF por empresa y tipo de e-CF (ADR-0007 §2).
 *
 * La DGII asigna rangos de numeración autorizados por tipo de comprobante y
 * empresa. El número se asigna con UPDATE...RETURNING dentro de la misma
 * transacción del evento — tan crítico como un número de cheque, nunca se
 * puede repetir ni saltar en silencio.
 */
export const secuenciasEcf = pgTable(
  'secuencia_ecf',
  {
    id: uuid('id').primaryKey().$defaultFn(() => newId()),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    empresaId: uuid('empresa_id').notNull().references(() => empresas.id),

    tipoEcf: varchar('tipo_ecf', { length: 3 }).notNull(),

    proximoNumero: integer('proximo_numero').notNull().default(1),
    rangoAutorizadoDesde: integer('rango_autorizado_desde'),
    rangoAutorizadoHasta: integer('rango_autorizado_hasta'),

    ...auditColumns,
  },
  (t) => ({
    tenantIdx: index('secuencia_ecf_tenant_idx').on(t.tenantId),
    empresaTipoUniq: uniqueIndex('secuencia_ecf_empresa_tipo_unique').on(t.empresaId, t.tipoEcf),
    tipoCheck: check('secuencia_ecf_tipo_check', sql`${t.tipoEcf} IN ('E31','E32','E33','E34')`),
  }),
);

export type SecuenciaEcfInsert = typeof secuenciasEcf.$inferInsert;
export type SecuenciaEcfSelect = typeof secuenciasEcf.$inferSelect;
