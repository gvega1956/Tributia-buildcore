import { pgTable, uuid, varchar, timestamp, date, jsonb, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { newId } from '@tributia/shared';
import { tenants } from '../core/tenant.js';
import { comprobantesEcf } from './comprobante_ecf.js';
import { auditColumns } from '../core/audit.js';

/**
 * acuse_ecf — acuse de recepción de la DGII para un e-CF transmitido (ADR-0007 §3).
 *
 * 1:1 con comprobante_ecf — solo existe cuando el middleware transmitió y la
 * DGII respondió (estado != CONTINGENCIA). `hash_integridad` permite
 * verificar que el acuse guardado no fue alterado después de recibido.
 */
export const acusesEcf = pgTable(
  'acuse_ecf',
  {
    id: uuid('id').primaryKey().$defaultFn(() => newId()),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    comprobanteEcfId: uuid('comprobante_ecf_id').notNull().references(() => comprobantesEcf.id),

    estadoDgii: varchar('estado_dgii', { length: 20 }).notNull(),
    codigoSeguridad: varchar('codigo_seguridad', { length: 20 }),
    fechaRecepcionDgii: timestamp('fecha_recepcion_dgii', { withTimezone: true }),

    payload: jsonb('payload').notNull(),
    hashIntegridad: varchar('hash_integridad', { length: 64 }).notNull(),

    retenerHasta: date('retener_hasta').notNull(),

    ...auditColumns,
  },
  (t) => ({
    tenantIdx: index('acuse_ecf_tenant_idx').on(t.tenantId),
    comprobanteUniq: uniqueIndex('acuse_ecf_comprobante_unique').on(t.comprobanteEcfId),
  }),
);

export type AcuseEcfInsert = typeof acusesEcf.$inferInsert;
export type AcuseEcfSelect = typeof acusesEcf.$inferSelect;
