import {
  pgTable,
  uuid,
  varchar,
  text,
  numeric,
  date,
  integer,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { newId } from '@tributia/shared';
import { tenants } from '../core/tenant.js';
import { terceros } from '../catalogos/tercero.js';
import { solicitudesCotizacion, lineasSoc } from './solicitud_cotizacion.js';
import { auditColumns, softDeleteColumns } from '../core/audit.js';

export const ESTADOS_COTIZACION = [
  'RECIBIDA',
  'EVALUADA',
  'SELECCIONADA',
  'RECHAZADA',
] as const;
export type EstadoCotizacion = (typeof ESTADOS_COTIZACION)[number];

export const cotizaciones = pgTable(
  'cotizacion',
  {
    id: uuid('id').primaryKey().$defaultFn(() => newId()),

    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),

    socId: uuid('soc_id')
      .notNull()
      .references(() => solicitudesCotizacion.id),

    terceroId: uuid('tercero_id')
      .notNull()
      .references(() => terceros.id),

    numeroCotizacionProveedor: varchar('numero_cotizacion_proveedor', { length: 50 }),

    fechaEmision: date('fecha_emision'),

    fechaValidez: date('fecha_validez'),

    estado: varchar('estado', { length: 20 })
      .notNull()
      .default('RECIBIDA')
      .$type<EstadoCotizacion>(),

    condicionesPago: varchar('condiciones_pago', { length: 200 }),

    notas: text('notas'),

    ...auditColumns,
    ...softDeleteColumns,
  },
  (t) => ({
    tenantIdx: index('cotizacion_tenant_id_idx').on(t.tenantId),
    socIdx: index('cotizacion_soc_id_idx').on(t.socId),
    terceroIdx: index('cotizacion_tercero_id_idx').on(t.terceroId),
    estadoCheck: check(
      'cotizacion_estado_check',
      sql`${t.estado} IN ('RECIBIDA','EVALUADA','SELECCIONADA','RECHAZADA')`,
    ),
  }),
);

export const lineasCotizacion = pgTable(
  'linea_cotizacion',
  {
    id: uuid('id').primaryKey().$defaultFn(() => newId()),

    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),

    cotizacionId: uuid('cotizacion_id')
      .notNull()
      .references(() => cotizaciones.id),

    lineaSocId: uuid('linea_soc_id')
      .notNull()
      .references(() => lineasSoc.id),

    precioUnitario: numeric('precio_unitario', { precision: 18, scale: 4 }).notNull(),
    cantidad: numeric('cantidad', { precision: 18, scale: 4 }).notNull(),
    total: numeric('total', { precision: 18, scale: 4 }).notNull(),
    moneda: varchar('moneda', { length: 3 }).notNull().default('DOP'),

    plazoEntregaDias: integer('plazo_entrega_dias'),

    ...auditColumns,
  },
  (t) => ({
    tenantIdx: index('linea_cot_tenant_id_idx').on(t.tenantId),
    cotizacionIdx: index('linea_cot_cotizacion_id_idx').on(t.cotizacionId),
    lineaSocIdx: index('linea_cot_linea_soc_id_idx').on(t.lineaSocId),
    // Un precio por línea SOC por cotización
    uniqCotLineaSoc: uniqueIndex('linea_cot_cotizacion_linea_soc_unique').on(
      t.cotizacionId,
      t.lineaSocId,
    ),
  }),
);

export type CotizacionInsert = typeof cotizaciones.$inferInsert;
export type CotizacionSelect = typeof cotizaciones.$inferSelect;
export type LineaCotizacionInsert = typeof lineasCotizacion.$inferInsert;
export type LineaCotizacionSelect = typeof lineasCotizacion.$inferSelect;
