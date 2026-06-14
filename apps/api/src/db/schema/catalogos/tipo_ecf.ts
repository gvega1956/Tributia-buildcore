import { pgTable, uuid, varchar, boolean, date, text } from 'drizzle-orm/pg-core';
import { newId } from '@tributia/shared';

/**
 * tipo_ecf — tipos de Comprobante Fiscal Electrónico habilitados por la DGII.
 *
 * Tabla de sistema (NO tiene tenant_id): los tipos de e-CF son iguales
 * para todos los tenants. Versionada por valido_desde/valido_hasta.
 * La DGII puede habilitar, deshabilitar o cambiar el nombre de los tipos.
 *
 * Sin RLS — rol tributia_app solo puede SELECT.
 */
export const tiposEcf = pgTable('tipo_ecf', {
  id: uuid('id').primaryKey().$defaultFn(() => newId()),

  // Código DGII: '31', '32', '33', '34', '41', '43', '44', '45', '46', '47'
  codigo: varchar('codigo', { length: 3 }).notNull().unique(),

  nombre: varchar('nombre', { length: 200 }).notNull(),
  descripcion: text('descripcion').notNull(),

  // Vigencia: null en valido_hasta = sigue vigente
  validoDesde: date('valido_desde').notNull(),
  validoHasta: date('valido_hasta'),

  activo: boolean('activo').notNull().default(true),
});

export type TipoEcfInsert = typeof tiposEcf.$inferInsert;
export type TipoEcfSelect = typeof tiposEcf.$inferSelect;
