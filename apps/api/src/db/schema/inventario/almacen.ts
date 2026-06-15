import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { newId } from '@tributia/shared';
import { tenants, empresas } from '../core/tenant.js';
import { auditColumns, softDeleteColumns } from '../core/audit.js';

export const TIPOS_ALMACEN = ['CENTRAL', 'OBRA', 'TRANSITO'] as const;
export type TipoAlmacen = (typeof TIPOS_ALMACEN)[number];

export const almacenes = pgTable(
  'almacen',
  {
    id: uuid('id').primaryKey().$defaultFn(() => newId()),

    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),

    empresaId: uuid('empresa_id')
      .notNull()
      .references(() => empresas.id),

    proyectoId: uuid('proyecto_id'),

    tipo: varchar('tipo', { length: 20 }).notNull().$type<TipoAlmacen>(),

    codigo: varchar('codigo', { length: 50 }).notNull(),
    nombre: varchar('nombre', { length: 200 }).notNull(),
    ubicacionFisica: text('ubicacion_fisica'),

    activo: boolean('activo').notNull().default(true),

    ...auditColumns,
    ...softDeleteColumns,
  },
  (t) => ({
    tenantIdx: index('almacen_tenant_idx').on(t.tenantId),
    empresaIdx: index('almacen_empresa_idx').on(t.empresaId),
    codigoUniq: uniqueIndex('almacen_tenant_codigo_unique').on(t.tenantId, t.codigo),
    tipoCheck: check(
      'almacen_tipo_check',
      sql`${t.tipo} IN ('CENTRAL','OBRA','TRANSITO')`,
    ),
  }),
);

export const ubicaciones = pgTable(
  'ubicacion_almacen',
  {
    id: uuid('id').primaryKey().$defaultFn(() => newId()),

    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),

    almacenId: uuid('almacen_id')
      .notNull()
      .references(() => almacenes.id),

    codigo: varchar('codigo', { length: 50 }).notNull(),
    nombre: varchar('nombre', { length: 200 }).notNull(),

    ...auditColumns,
  },
  (t) => ({
    tenantIdx: index('ubicacion_almacen_tenant_idx').on(t.tenantId),
    almacenIdx: index('ubicacion_almacen_almacen_idx').on(t.almacenId),
    codigoUniq: uniqueIndex('ubicacion_almacen_codigo_unique').on(t.almacenId, t.codigo),
  }),
);

export type AlmacenInsert = typeof almacenes.$inferInsert;
export type AlmacenSelect = typeof almacenes.$inferSelect;
export type UbicacionInsert = typeof ubicaciones.$inferInsert;
export type UbicacionSelect = typeof ubicaciones.$inferSelect;
