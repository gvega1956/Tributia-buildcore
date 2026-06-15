import {
  pgTable,
  uuid,
  varchar,
  text,
  numeric,
  date,
  timestamp,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { newId } from '@tributia/shared';
import { tenants, empresas } from '../core/tenant.js';
import { terceros } from '../catalogos/tercero.js';
import { lineasRequisicion } from './requisicion.js';
import { auditColumns, softDeleteColumns } from '../core/audit.js';

export const ESTADOS_SOC = ['BORRADOR', 'ENVIADA', 'CERRADA', 'CANCELADA'] as const;
export type EstadoSoc = (typeof ESTADOS_SOC)[number];

export const solicitudesCotizacion = pgTable(
  'solicitud_cotizacion',
  {
    id: uuid('id').primaryKey().$defaultFn(() => newId()),

    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),

    empresaId: uuid('empresa_id')
      .notNull()
      .references(() => empresas.id),

    numero: varchar('numero', { length: 30 }).notNull(),

    estado: varchar('estado', { length: 20 })
      .notNull()
      .default('BORRADOR')
      .$type<EstadoSoc>(),

    fechaVencimiento: date('fecha_vencimiento'),

    notas: text('notas'),

    ...auditColumns,
    ...softDeleteColumns,
  },
  (t) => ({
    tenantIdx: index('soc_tenant_id_idx').on(t.tenantId),
    numeroUniq: uniqueIndex('soc_tenant_numero_unique').on(t.tenantId, t.numero),
    estadoCheck: check(
      'soc_estado_check',
      sql`${t.estado} IN ('BORRADOR','ENVIADA','CERRADA','CANCELADA')`,
    ),
  }),
);

/** Consolidación: una SOC puede incluir líneas de varias requisiciones aprobadas. */
export const lineasSoc = pgTable(
  'linea_soc',
  {
    id: uuid('id').primaryKey().$defaultFn(() => newId()),

    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),

    socId: uuid('soc_id')
      .notNull()
      .references(() => solicitudesCotizacion.id),

    lineaRequisicionId: uuid('linea_requisicion_id')
      .notNull()
      .references(() => lineasRequisicion.id),

    cantidad: numeric('cantidad', { precision: 18, scale: 4 }).notNull(),
    unidadMedida: varchar('unidad_medida', { length: 20 }).notNull(),
    descripcion: varchar('descripcion', { length: 500 }).notNull(),

    ...auditColumns,
  },
  (t) => ({
    tenantIdx: index('linea_soc_tenant_id_idx').on(t.tenantId),
    socIdx: index('linea_soc_soc_id_idx').on(t.socId),
    lineaReqIdx: index('linea_soc_linea_req_idx').on(t.lineaRequisicionId),
  }),
);

/** Proveedores a quienes se envió la SOC. */
export const socProveedores = pgTable(
  'soc_proveedor',
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

    enviadaEn: timestamp('enviada_en', { withTimezone: true }),

    ...auditColumns,
  },
  (t) => ({
    tenantIdx: index('soc_prov_tenant_id_idx').on(t.tenantId),
    socIdx: index('soc_prov_soc_id_idx').on(t.socId),
    uniqSocTercero: uniqueIndex('soc_prov_soc_tercero_unique').on(t.socId, t.terceroId),
  }),
);

export type SolicitudCotizacionInsert = typeof solicitudesCotizacion.$inferInsert;
export type SolicitudCotizacionSelect = typeof solicitudesCotizacion.$inferSelect;
export type LineaSocInsert = typeof lineasSoc.$inferInsert;
export type LineaSocSelect = typeof lineasSoc.$inferSelect;
export type SocProveedorInsert = typeof socProveedores.$inferInsert;
export type SocProveedorSelect = typeof socProveedores.$inferSelect;
