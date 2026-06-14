import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  numeric,
  boolean,
  index,
} from 'drizzle-orm/pg-core';
import { newId } from '@tributia/shared';
import type { TipoLineaApu } from '@tributia/proyectos';
import { tenants } from '../core/tenant.js';
import { partidas } from './partida.js';
import { insumos } from '../catalogos/insumo.js';
import { equiposCatalogo } from '../catalogos/equipo_catalogo.js';
import { unidadesMedida } from '../catalogos/unidad_medida.js';
import { auditColumns, softDeleteColumns } from '../core/audit.js';

/**
 * apu — Análisis de Precio Unitario.
 *
 * Dos usos:
 *   - Biblioteca (es_biblioteca=true, partida_id=null): plantilla reutilizable
 *     y versionada a nivel tenant. Identidad: (tenant_id, codigo, version).
 *   - APU de partida (partida_id IS NOT NULL): precio unitario desglosado
 *     aplicado a esa partida. Máximo uno activo por partida (índice parcial).
 *
 * precio_unitario = Σ(apu_linea.precio_total). ApuService lo recalcula
 * y lo guarda en cada operación sobre las líneas (nunca se calcula on-the-fly
 * para evitar lecturas dobles).
 */
export const apus = pgTable(
  'apu',
  {
    id: uuid('id').primaryKey().$defaultFn(() => newId()),

    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),

    // null → entrada de biblioteca; NOT NULL → APU de una partida concreta
    partidaId: uuid('partida_id').references(() => partidas.id),

    esBiblioteca: boolean('es_biblioteca').notNull().default(false),

    codigo: varchar('codigo', { length: 50 }).notNull(),
    nombre: varchar('nombre', { length: 200 }).notNull(),
    descripcion: text('descripcion'),

    // versión del APU en la biblioteca (incrementa al crear nueva versión de plantilla)
    version: integer('version').notNull().default(1),

    unidadMedidaId: uuid('unidad_medida_id').references(() => unidadesMedida.id),

    // suma de precio_total de las líneas; actualizado por ApuService
    precioUnitario: numeric('precio_unitario', { precision: 18, scale: 4 })
      .notNull()
      .default('0.0000'),
    moneda: varchar('moneda', { length: 3 }).notNull().default('DOP'),

    activo: boolean('activo').notNull().default(true),

    ...auditColumns,
    ...softDeleteColumns,
  },
  (t) => ({
    tenantIdx: index('apu_tenant_id_idx').on(t.tenantId),
    partidaIdx: index('apu_partida_id_idx').on(t.partidaId),
    // Índices parciales únicos implementados en migration SQL:
    //   UNIQUE (partida_id) WHERE partida_id IS NOT NULL AND deleted_at IS NULL
    //   UNIQUE (tenant_id, codigo, version) WHERE es_biblioteca = true
  }),
);

/**
 * apu_linea — una línea de insumo dentro de un APU.
 *
 * tipo:
 *   MATERIAL   → insumo_id (referencia al catálogo de insumos/materiales)
 *   MANO_OBRA  → descripcion libre (tarifa de oficio); insumo_id puede referenciar
 *                un insumo de tipo MANO_OBRA si se crea en catálogo
 *   EQUIPO     → equipo_catalogo_id (usa tarifa_horaria del catálogo)
 *   SUBCONTRATO → descripcion libre
 *
 * precio_total = cantidad × precio_unitario (calculado con Decimal y guardado).
 */
export const apuLineas = pgTable(
  'apu_linea',
  {
    id: uuid('id').primaryKey().$defaultFn(() => newId()),

    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),

    apuId: uuid('apu_id')
      .notNull()
      .references(() => apus.id),

    tipo: varchar('tipo', { length: 30 }).notNull().$type<TipoLineaApu>(),

    insumoId: uuid('insumo_id').references(() => insumos.id),
    equipoCatalogoId: uuid('equipo_catalogo_id').references(() => equiposCatalogo.id),
    descripcion: varchar('descripcion', { length: 500 }),

    cantidad: numeric('cantidad', { precision: 18, scale: 4 }).notNull(),
    precioUnitario: numeric('precio_unitario', { precision: 18, scale: 4 }).notNull(),
    // precio_total = cantidad × precio_unitario; calculado con Decimal, guardado aquí
    precioTotal: numeric('precio_total', { precision: 18, scale: 4 }).notNull(),

    moneda: varchar('moneda', { length: 3 }).notNull().default('DOP'),
    orden: integer('orden').notNull().default(1),

    ...auditColumns,
  },
  (t) => ({
    apuIdx: index('apu_linea_apu_id_idx').on(t.apuId),
    // CHECK (tipo IN (...)) se agrega en la migration SQL
  }),
);

export type ApuInsert = typeof apus.$inferInsert;
export type ApuSelect = typeof apus.$inferSelect;
export type ApuLineaInsert = typeof apuLineas.$inferInsert;
export type ApuLineaSelect = typeof apuLineas.$inferSelect;
