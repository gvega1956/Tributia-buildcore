import { pgTable, uuid, varchar, boolean, date, numeric } from 'drizzle-orm/pg-core';
import { newId } from '@tributia/shared';

/**
 * tasa_itbis — tasas del Impuesto sobre Transferencias de Bienes Industrializados
 * y Servicios (ITBIS) publicadas por la DGII.
 *
 * Tabla de sistema (sin tenant_id). Versionada con vigencia.
 * La tasa general actual es 18%. Existen tasas reducidas (0%) para exentos.
 *
 * Sin RLS — rol tributia_app solo puede SELECT.
 */
export const tasasItbis = pgTable('tasa_itbis', {
  id: uuid('id').primaryKey().$defaultFn(() => newId()),

  // Código interno: 'ITBIS_18', 'ITBIS_16', 'ITBIS_0_EXENTO', etc.
  codigo: varchar('codigo', { length: 20 }).notNull().unique(),

  // Porcentaje: 18.00, 16.00, 0.00
  porcentaje: numeric('porcentaje', { precision: 5, scale: 2 }).notNull(),

  descripcion: varchar('descripcion', { length: 300 }).notNull(),

  validoDesde: date('valido_desde').notNull(),
  validoHasta: date('valido_hasta'),

  activo: boolean('activo').notNull().default(true),
});

export type TasaItbisInsert = typeof tasasItbis.$inferInsert;
export type TasaItbisSelect = typeof tasasItbis.$inferSelect;
