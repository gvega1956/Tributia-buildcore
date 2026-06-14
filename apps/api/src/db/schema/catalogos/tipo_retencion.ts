import { pgTable, uuid, varchar, boolean, date, numeric, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { newId } from '@tributia/shared';

/**
 * tipo_retencion — tipos de retención fiscal vigentes en RD según DGII.
 *
 * Incluye: ISR personas físicas, ISR proveedores del Estado (5%),
 * ITBIS retenido a servicios profesionales, retenciones TSS, etc.
 *
 * Tabla de sistema (sin tenant_id). Versionada con vigencia.
 *
 * Sin RLS — rol tributia_app solo puede SELECT.
 */
export const tiposRetencion = pgTable(
  'tipo_retencion',
  {
    id: uuid('id').primaryKey().$defaultFn(() => newId()),

    // Código interno: 'ISR_PERSONAS_FISICAS', 'ISR_ESTADO_5PCT', etc.
    codigo: varchar('codigo', { length: 30 }).notNull().unique(),

    nombre: varchar('nombre', { length: 200 }).notNull(),

    porcentaje: numeric('porcentaje', { precision: 5, scale: 2 }).notNull(),

    // A qué aplica la retención
    aplicaA: varchar('aplica_a', { length: 20 }).notNull().$type<'SERVICIOS' | 'BIENES' | 'AMBOS'>(),

    descripcion: varchar('descripcion', { length: 500 }).notNull(),

    validoDesde: date('valido_desde').notNull(),
    validoHasta: date('valido_hasta'),

    activo: boolean('activo').notNull().default(true),
  },
  (t) => ({
    aplicaACheck: check(
      'tipo_retencion_aplica_check',
      sql`${t.aplicaA} IN ('SERVICIOS','BIENES','AMBOS')`,
    ),
  }),
);

export type TipoRetencionInsert = typeof tiposRetencion.$inferInsert;
export type TipoRetencionSelect = typeof tiposRetencion.$inferSelect;
