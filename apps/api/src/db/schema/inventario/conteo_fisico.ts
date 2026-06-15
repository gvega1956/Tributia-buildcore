import {
  pgTable,
  uuid,
  varchar,
  date,
  text,
  numeric,
  boolean,
  index,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { newId } from '@tributia/shared';
import { tenants, empresas } from '../core/tenant.js';
import { almacenes } from './almacen.js';
import { insumos } from '../catalogos/insumo.js';
import { auditColumns, softDeleteColumns } from '../core/audit.js';

export const ESTADOS_CONTEO = ['BORRADOR', 'FINALIZADO', 'CANCELADO'] as const;
export type EstadoConteoFisico = (typeof ESTADOS_CONTEO)[number];

export const conteosFisicos = pgTable(
  'conteo_fisico',
  {
    id: uuid('id').primaryKey().$defaultFn(() => newId()),

    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),

    empresaId: uuid('empresa_id')
      .notNull()
      .references(() => empresas.id),

    almacenId: uuid('almacen_id')
      .notNull()
      .references(() => almacenes.id),

    fechaConteo: date('fecha_conteo').notNull(),
    estado: varchar('estado', { length: 20 }).notNull().default('BORRADOR').$type<EstadoConteoFisico>(),
    responsableId: uuid('responsable_id').notNull(),
    notas: text('notas'),

    ...auditColumns,
    ...softDeleteColumns,
  },
  (t) => ({
    tenantIdx: index('conteo_fisico_tenant_idx').on(t.tenantId),
    almacenIdx: index('conteo_fisico_almacen_idx').on(t.almacenId),
    estadoCheck: check(
      'conteo_fisico_estado_check',
      sql`${t.estado} IN ('BORRADOR','FINALIZADO','CANCELADO')`,
    ),
  }),
);

export const lineasConteoFisico = pgTable(
  'linea_conteo_fisico',
  {
    id: uuid('id').primaryKey().$defaultFn(() => newId()),

    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),

    conteoId: uuid('conteo_id')
      .notNull()
      .references(() => conteosFisicos.id),

    insumoId: uuid('insumo_id')
      .notNull()
      .references(() => insumos.id),

    cantidadSistema: numeric('cantidad_sistema', { precision: 18, scale: 4 }).notNull(),
    cantidadFisica: numeric('cantidad_fisica', { precision: 18, scale: 4 }).notNull(),
    costoUnitario: numeric('costo_unitario', { precision: 18, scale: 4 }).notNull(),
    moneda: varchar('moneda', { length: 3 }).notNull().default('DOP'),
    ajusteGenerado: boolean('ajuste_generado').notNull().default(false),

    ...auditColumns,
  },
  (t) => ({
    tenantIdx: index('linea_conteo_tenant_idx').on(t.tenantId),
    conteoIdx: index('linea_conteo_conteo_idx').on(t.conteoId),
  }),
);

export const herramientasAsignadas = pgTable(
  'herramienta_asignada',
  {
    id: uuid('id').primaryKey().$defaultFn(() => newId()),

    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),

    insumoId: uuid('insumo_id')
      .notNull()
      .references(() => insumos.id),

    proyectoId: uuid('proyecto_id'),

    asignadoA: uuid('asignado_a').notNull(),
    fechaAsignacion: date('fecha_asignacion').notNull(),
    fechaDevolucion: date('fecha_devolucion'),

    estado: varchar('estado', { length: 20 }).notNull().default('ASIGNADA'),

    ...auditColumns,
    ...softDeleteColumns,
  },
  (t) => ({
    tenantIdx: index('herramienta_asignada_tenant_idx').on(t.tenantId),
    insumoIdx: index('herramienta_asignada_insumo_idx').on(t.insumoId),
    estadoCheck: check(
      'herramienta_asignada_estado_check',
      sql`${t.estado} IN ('ASIGNADA','DEVUELTA','DADA_DE_BAJA')`,
    ),
  }),
);

export type ConteoFisicoInsert = typeof conteosFisicos.$inferInsert;
export type ConteoFisicoSelect = typeof conteosFisicos.$inferSelect;
export type LineaConteoFisicoInsert = typeof lineasConteoFisico.$inferInsert;
export type LineaConteoFisicoSelect = typeof lineasConteoFisico.$inferSelect;
export type HerramientaAsignadaInsert = typeof herramientasAsignadas.$inferInsert;
export type HerramientaAsignadaSelect = typeof herramientasAsignadas.$inferSelect;
