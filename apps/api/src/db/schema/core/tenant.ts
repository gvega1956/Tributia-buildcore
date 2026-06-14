import { pgTable, uuid, varchar, boolean, text, check, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { newId } from '@tributia/shared';
import { auditColumns } from './audit.js';

/**
 * tenant — la constructora cliente de Tributia BuildCore.
 * SIN tenant_id propio (es la raíz de la jerarquía).
 * SIN RLS: es el registro de tenants del sistema.
 */
export const tenants = pgTable('tenant', {
  id: uuid('id').primaryKey().$defaultFn(() => newId()),
  nombre: varchar('nombre', { length: 200 }).notNull(),
  slug: varchar('slug', { length: 50 }).notNull().unique(),
  activo: boolean('activo').notNull().default(true),
  ...auditColumns,
});

/**
 * empresa — razón social / RNC dentro de un tenant.
 * Tiene tenant_id + RLS (ver migración 0000_tenancy.sql).
 */
export const empresas = pgTable(
  'empresa',
  {
    id: uuid('id').primaryKey().$defaultFn(() => newId()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    nombre: varchar('nombre', { length: 200 }).notNull(),
    rnc: varchar('rnc', { length: 9 }),
    activo: boolean('activo').notNull().default(true),
    ...auditColumns,
  },
  (t) => ({
    tenantIdx: index('empresa_tenant_id_idx').on(t.tenantId),
  }),
);

/**
 * sucursal — oficina o centro de operaciones dentro de una empresa.
 * Tiene tenant_id + RLS.
 */
export const sucursales = pgTable(
  'sucursal',
  {
    id: uuid('id').primaryKey().$defaultFn(() => newId()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    empresaId: uuid('empresa_id')
      .notNull()
      .references(() => empresas.id),
    nombre: varchar('nombre', { length: 200 }).notNull(),
    direccion: text('direccion'),
    activo: boolean('activo').notNull().default(true),
    ...auditColumns,
  },
  (t) => ({
    tenantIdx: index('sucursal_tenant_id_idx').on(t.tenantId),
  }),
);

/** @see TIPOS_CENTRO_COSTO */
export type TipoCentroCosto = 'PROYECTO' | 'ADMINISTRATIVO';

/**
 * centro_costo — dimensión obligatoria de imputación (P3).
 * Tipo PROYECTO (ligado a un proyecto) o ADMINISTRATIVO (gastos generales).
 * Tiene tenant_id + RLS.
 */
export const centrosCosto = pgTable(
  'centro_costo',
  {
    id: uuid('id').primaryKey().$defaultFn(() => newId()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    empresaId: uuid('empresa_id')
      .notNull()
      .references(() => empresas.id),
    codigo: varchar('codigo', { length: 50 }).notNull(),
    nombre: varchar('nombre', { length: 200 }).notNull(),
    tipo: varchar('tipo', { length: 20 }).notNull().$type<TipoCentroCosto>(),
    activo: boolean('activo').notNull().default(true),
    ...auditColumns,
  },
  (t) => ({
    tenantIdx: index('centro_costo_tenant_id_idx').on(t.tenantId),
    tenantCodigoUniqueIdx: uniqueIndex('centro_costo_tenant_codigo_idx').on(
      t.tenantId,
      t.empresaId,
      t.codigo,
    ),
    tipoCheck: check('centro_costo_tipo_check', sql`${t.tipo} IN ('PROYECTO', 'ADMINISTRATIVO')`),
  }),
);

export type TenantInsert = typeof tenants.$inferInsert;
export type TenantSelect = typeof tenants.$inferSelect;
export type EmpresaInsert = typeof empresas.$inferInsert;
export type EmpresaSelect = typeof empresas.$inferSelect;
export type SucursalInsert = typeof sucursales.$inferInsert;
export type SucursalSelect = typeof sucursales.$inferSelect;
export type CentroCostoInsert = typeof centrosCosto.$inferInsert;
export type CentroCostoSelect = typeof centrosCosto.$inferSelect;
