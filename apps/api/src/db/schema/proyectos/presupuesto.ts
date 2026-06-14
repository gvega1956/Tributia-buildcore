import {
  pgTable,
  uuid,
  varchar,
  text,
  numeric,
  boolean,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { newId } from '@tributia/shared';
import type {
  TipoVersionPresupuesto,
  EstadoVersionPresupuesto,
} from '@tributia/proyectos';
import { tenants } from '../core/tenant.js';
import { proyectos } from './proyecto.js';
import { partidas } from './partida.js';
import { apus } from './apu.js';
import { auditColumns, softDeleteColumns } from '../core/audit.js';

/**
 * version_presupuesto — snapshot formal del presupuesto de un proyecto.
 *
 * tipo:
 *   BORRADOR  → trabajando; puede editarse libremente.
 *   BASE      → presupuesto de control. Solo puede haber un BASE aprobado
 *               por proyecto. Una vez aprobado (estado=APROBADO), sus líneas
 *               son inmutables (protegido por trigger en DB).
 *
 * total_directo + total_indirecto = total_presupuesto (mantenido por PresupuestoService).
 */
export const versionesPresupuesto = pgTable(
  'version_presupuesto',
  {
    id: uuid('id').primaryKey().$defaultFn(() => newId()),

    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),

    proyectoId: uuid('proyecto_id')
      .notNull()
      .references(() => proyectos.id),

    nombre: varchar('nombre', { length: 200 }).notNull(),

    tipo: varchar('tipo', { length: 20 })
      .notNull()
      .default('BORRADOR')
      .$type<TipoVersionPresupuesto>(),

    estado: varchar('estado', { length: 20 })
      .notNull()
      .default('PENDIENTE')
      .$type<EstadoVersionPresupuesto>(),

    notas: text('notas'),
    moneda: varchar('moneda', { length: 3 }).notNull().default('DOP'),

    // Totales calculados por PresupuestoService con Decimal
    totalDirecto: numeric('total_directo', { precision: 18, scale: 4 })
      .notNull()
      .default('0.0000'),
    totalIndirecto: numeric('total_indirecto', { precision: 18, scale: 4 })
      .notNull()
      .default('0.0000'),
    totalPresupuesto: numeric('total_presupuesto', { precision: 18, scale: 4 })
      .notNull()
      .default('0.0000'),

    aprobadoPor: uuid('aprobado_por'),
    aprobadoEn: timestamp('aprobado_en', { withTimezone: true }),

    ...auditColumns,
    ...softDeleteColumns,
  },
  (t) => ({
    tenantIdx: index('vp_tenant_id_idx').on(t.tenantId),
    proyectoIdx: index('vp_proyecto_id_idx').on(t.proyectoId),
    // Solo puede haber un BASE aprobado por proyecto (índice parcial en migration SQL):
    // UNIQUE (proyecto_id) WHERE tipo = 'BASE' AND estado = 'APROBADO'
    tipoCheck: uniqueIndex('vp_tipo_estado_check').on(t.proyectoId).where(
      sql`${t.tipo} = 'BASE' AND ${t.estado} = 'APROBADO' AND ${t.deletedAt} IS NULL`,
    ),
  }),
);

/**
 * linea_presupuesto — cantidad presupuestada y precio unitario de una partida
 * dentro de una versión de presupuesto.
 *
 * total = cantidad × precio_unitario (Decimal, guardado).
 * es_indirecto = true para capítulo de indirectos del proyecto.
 *
 * IMMUTABLE si version_presupuesto.estado = 'APROBADO':
 * un trigger en DB rechaza UPDATE/DELETE cuando la versión está aprobada.
 */
export const lineasPresupuesto = pgTable(
  'linea_presupuesto',
  {
    id: uuid('id').primaryKey().$defaultFn(() => newId()),

    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),

    versionPresupuestoId: uuid('version_presupuesto_id')
      .notNull()
      .references(() => versionesPresupuesto.id),

    partidaId: uuid('partida_id')
      .notNull()
      .references(() => partidas.id),

    // APU del que proviene el precio_unitario (puede ser nulo si se ingresó manualmente)
    apuId: uuid('apu_id').references(() => apus.id),

    cantidad: numeric('cantidad', { precision: 18, scale: 4 }).notNull(),
    precioUnitario: numeric('precio_unitario', { precision: 18, scale: 4 }).notNull(),
    total: numeric('total', { precision: 18, scale: 4 }).notNull(),

    moneda: varchar('moneda', { length: 3 }).notNull().default('DOP'),

    esIndirecto: boolean('es_indirecto').notNull().default(false),

    ...auditColumns,
  },
  (t) => ({
    versionIdx: index('lp_version_presupuesto_id_idx').on(t.versionPresupuestoId),
    partidaIdx: index('lp_partida_id_idx').on(t.partidaId),
    // Una sola línea por partida dentro de la misma versión
    versionPartidaUniq: uniqueIndex('lp_version_partida_unique').on(
      t.versionPresupuestoId,
      t.partidaId,
    ),
  }),
);

export type VersionPresupuestoInsert = typeof versionesPresupuesto.$inferInsert;
export type VersionPresupuestoSelect = typeof versionesPresupuesto.$inferSelect;
export type LineaPresupuestoInsert = typeof lineasPresupuesto.$inferInsert;
export type LineaPresupuestoSelect = typeof lineasPresupuesto.$inferSelect;
