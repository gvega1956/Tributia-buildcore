import {
  pgTable,
  uuid,
  varchar,
  boolean,
  numeric,
  text,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { newId } from '@tributia/shared';
import type { CategoriaInsumo } from '@tributia/catalogos';
import { tenants } from '../core/tenant.js';
import { unidadesMedida } from './unidad_medida.js';
import { auditColumns, softDeleteColumns } from '../core/audit.js';

/**
 * insumo — catálogo de materiales e insumos de la constructora (P4.4).
 * Referenciado desde APUs, requisiciones, recepciones y consumos.
 * Con RLS: cada tenant gestiona su catálogo propio.
 */
export const insumos = pgTable(
  'insumo',
  {
    id: uuid('id').primaryKey().$defaultFn(() => newId()),

    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),

    codigo: varchar('codigo', { length: 50 }).notNull(),
    nombre: varchar('nombre', { length: 200 }).notNull(),
    descripcion: text('descripcion'),

    unidadId: uuid('unidad_id')
      .notNull()
      .references(() => unidadesMedida.id),

    categoria: varchar('categoria', { length: 30 })
      .notNull()
      .default('MATERIAL')
      .$type<CategoriaInsumo>(),

    // Código del bien/servicio DGII para e-CF (opcional)
    codigoDgii: varchar('codigo_dgii', { length: 20 }),

    activo: boolean('activo').notNull().default(true),

    ...auditColumns,
    ...softDeleteColumns,
  },
  (t) => ({
    tenantIdx: index('insumo_tenant_idx').on(t.tenantId),
    tenantCodigoUniq: uniqueIndex('insumo_tenant_codigo_unique').on(t.tenantId, t.codigo),
    categoriaCheck: check(
      'insumo_categoria_check',
      sql`${t.categoria} IN ('MATERIAL','CONSUMIBLE','HERRAMIENTA_MENOR','QUIMICO','COMBUSTIBLE','OTRO')`,
    ),
  }),
);

/**
 * insumo_equivalencia — factores de conversión entre unidades para un insumo.
 * Ejemplo: 1 saco de cemento (SC) = 42.5 KG.
 * Idempotente: UNIQUE(insumo_id, unidad_origen_id, unidad_destino_id).
 */
export const insumosEquivalencia = pgTable(
  'insumo_equivalencia',
  {
    id: uuid('id').primaryKey().$defaultFn(() => newId()),

    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),

    insumoId: uuid('insumo_id')
      .notNull()
      .references(() => insumos.id),

    unidadOrigenId: uuid('unidad_origen_id')
      .notNull()
      .references(() => unidadesMedida.id),

    // 1 unidad_origen = factor × unidad_destino
    factor: numeric('factor', { precision: 18, scale: 6 }).notNull(),

    unidadDestinoId: uuid('unidad_destino_id')
      .notNull()
      .references(() => unidadesMedida.id),

    ...auditColumns,
  },
  (t) => ({
    tenantIdx: index('equiv_tenant_idx').on(t.tenantId),
    uniq: uniqueIndex('equiv_insumo_origen_destino_unique').on(
      t.insumoId,
      t.unidadOrigenId,
      t.unidadDestinoId,
    ),
  }),
);

export type InsumoInsert = typeof insumos.$inferInsert;
export type InsumoSelect = typeof insumos.$inferSelect;
export type InsumoEquivalenciaInsert = typeof insumosEquivalencia.$inferInsert;
export type InsumoEquivalenciaSelect = typeof insumosEquivalencia.$inferSelect;
