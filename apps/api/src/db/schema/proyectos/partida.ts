import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  numeric,
  boolean,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { newId } from '@tributia/shared';
import { tenants } from '../core/tenant.js';
import { proyectos } from './proyecto.js';
import { unidadesMedida } from '../catalogos/unidad_medida.js';
import { auditColumns, softDeleteColumns } from '../core/audit.js';

/**
 * partida — nodo de la EDT (Estructura de Desglose de Trabajo) por proyecto.
 *
 * Jerarquía self-referencial (máx. 3 niveles):
 *   nivel 1 → Capítulo  (parent_id IS NULL)
 *   nivel 2 → Partida   (parent es un capítulo)
 *   nivel 3 → Sub-partida (parent es una partida)
 *
 * P5: es el ancla de imputación de TODO el sistema — presupuesto, compras,
 * consumo, avance, costo y facturación se imputan a una partida.
 *
 * numero_jerarquico es calculado y mantenido por PartidaService.
 * orden es la posición 1-based entre hermanos activos; se recompacta en
 * cada inserción, eliminación y reordenamiento.
 */
export const partidas = pgTable(
  'partida',
  {
    id: uuid('id').primaryKey().$defaultFn(() => newId()),

    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),

    proyectoId: uuid('proyecto_id')
      .notNull()
      .references(() => proyectos.id),

    // self-reference; se declara con lazy getter para evitar referencia circular
    parentId: uuid('parent_id').references((): AnyPgColumn => partidas.id),

    nivel: integer('nivel').notNull(), // 1=capítulo, 2=partida, 3=sub-partida

    // posición 1-based entre hermanos activos; siempre compacto (sin huecos)
    orden: integer('orden').notNull().default(1),

    // ej. "1.2.3" — derivado de parent.numero_jerarquico + "." + orden
    numeroJerarquico: varchar('numero_jerarquico', { length: 100 }).notNull(),

    codigo: varchar('codigo', { length: 50 }).notNull(),
    nombre: varchar('nombre', { length: 500 }).notNull(),
    descripcion: text('descripcion'),

    // FK al catálogo de unidades de medida (nullish para capítulos)
    unidadMedidaId: uuid('unidad_medida_id').references(() => unidadesMedida.id),

    // Cantidades presupuestadas — NUMERIC(18,4) siempre (nunca float)
    cantidadPresupuestada: numeric('cantidad_presupuestada', { precision: 18, scale: 4 }),
    precioUnitario: numeric('precio_unitario', { precision: 18, scale: 4 }),

    activo: boolean('activo').notNull().default(true),

    ...auditColumns,
    ...softDeleteColumns,
  },
  (t) => ({
    tenantIdx: index('partida_tenant_id_idx').on(t.tenantId),
    proyectoIdx: index('partida_proyecto_id_idx').on(t.proyectoId),
    parentIdx: index('partida_parent_id_idx').on(t.parentId),
    numeroIdx: index('partida_numero_jerarquico_idx').on(t.tenantId, t.proyectoId, t.numeroJerarquico),

    nivelCheck: check(
      'partida_nivel_check',
      sql`${t.nivel} BETWEEN 1 AND 3`,
    ),
    codigoProyectoUniq: uniqueIndex('partida_tenant_proyecto_codigo_unique').on(
      t.tenantId,
      t.proyectoId,
      t.codigo,
    ),
  }),
);

export type PartidaInsert = typeof partidas.$inferInsert;
export type PartidaSelect = typeof partidas.$inferSelect;
