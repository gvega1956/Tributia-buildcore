import { pgTable, uuid, varchar, boolean, uniqueIndex, index, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { newId } from '@tributia/shared';
import { tenants, empresas } from '../core/tenant.js';
import { auditColumns, softDeleteColumns } from '../core/audit.js';

export const AMBIENTES_EMISION_ECF = ['TEST', 'CERTIFICACION', 'PRODUCCION'] as const;
export type AmbienteEmisionEcf = (typeof AMBIENTES_EMISION_ECF)[number];

/**
 * configuracion_emisor_ecf — datos del emisor electrónico por empresa (ADR-0007 §2).
 *
 * Cada empresa es su propio emisor responsable ante la DGII: certificado y
 * autorización propios. `certificado_referencia` es SOLO un puntero opaco a
 * la bóveda de secretos (HSM/KMS) externa — la aplicación NUNCA almacena el
 * certificado en sí (§22 arquitectura.md).
 */
export const configuracionesEmisorEcf = pgTable(
  'configuracion_emisor_ecf',
  {
    id: uuid('id').primaryKey().$defaultFn(() => newId()),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    empresaId: uuid('empresa_id').notNull().references(() => empresas.id),

    ambiente: varchar('ambiente', { length: 20 })
      .notNull()
      .default('TEST')
      .$type<AmbienteEmisionEcf>(),

    rncEmisor: varchar('rnc_emisor', { length: 9 }).notNull(),
    razonSocialEmisor: varchar('razon_social_emisor', { length: 200 }).notNull(),

    // Puntero opaco a la bóveda de secretos — jamás el certificado en sí.
    certificadoReferencia: varchar('certificado_referencia', { length: 500 }).notNull(),

    activo: boolean('activo').notNull().default(true),

    ...auditColumns,
    ...softDeleteColumns,
  },
  (t) => ({
    tenantIdx: index('config_emisor_ecf_tenant_idx').on(t.tenantId),
    empresaUniq: uniqueIndex('config_emisor_ecf_empresa_unique').on(t.empresaId),
    ambienteCheck: check(
      'config_emisor_ecf_ambiente_check',
      sql`${t.ambiente} IN ('TEST','CERTIFICACION','PRODUCCION')`,
    ),
  }),
);

export type ConfiguracionEmisorEcfInsert = typeof configuracionesEmisorEcf.$inferInsert;
export type ConfiguracionEmisorEcfSelect = typeof configuracionesEmisorEcf.$inferSelect;
