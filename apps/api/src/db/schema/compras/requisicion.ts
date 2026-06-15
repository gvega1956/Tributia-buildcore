import {
  pgTable,
  uuid,
  varchar,
  text,
  numeric,
  date,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { newId } from '@tributia/shared';
import { tenants, empresas } from '../core/tenant.js';
import { partidas } from '../proyectos/partida.js';
import { insumos } from '../catalogos/insumo.js';
import { auditColumns, softDeleteColumns } from '../core/audit.js';

export const ESTADOS_REQUISICION = [
  'BORRADOR',
  'PENDIENTE_APROBACION',
  'APROBADA',
  'RECHAZADA',
  'CONSOLIDADA',
  'CANCELADA',
] as const;
export type EstadoRequisicion = (typeof ESTADOS_REQUISICION)[number];

export const requisiciones = pgTable(
  'requisicion',
  {
    id: uuid('id').primaryKey().$defaultFn(() => newId()),

    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),

    empresaId: uuid('empresa_id')
      .notNull()
      .references(() => empresas.id),

    numero: varchar('numero', { length: 30 }).notNull(),

    proyectoId: uuid('proyecto_id').notNull(),

    estado: varchar('estado', { length: 30 })
      .notNull()
      .default('BORRADOR')
      .$type<EstadoRequisicion>(),

    solicitadoPor: uuid('solicitado_por').notNull(),

    fechaRequerida: date('fecha_requerida'),

    notas: text('notas'),

    ...auditColumns,
    ...softDeleteColumns,
  },
  (t) => ({
    tenantIdx: index('req_tenant_id_idx').on(t.tenantId),
    proyectoIdx: index('req_proyecto_id_idx').on(t.proyectoId),
    numeroUniq: uniqueIndex('req_tenant_numero_unique').on(t.tenantId, t.numero),
    estadoCheck: check(
      'req_estado_check',
      sql`${t.estado} IN ('BORRADOR','PENDIENTE_APROBACION','APROBADA','RECHAZADA','CONSOLIDADA','CANCELADA')`,
    ),
  }),
);

export const lineasRequisicion = pgTable(
  'linea_requisicion',
  {
    id: uuid('id').primaryKey().$defaultFn(() => newId()),

    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),

    requisicionId: uuid('requisicion_id')
      .notNull()
      .references(() => requisiciones.id),

    // Imputación obligatoria a partida (principio 3: todo costo tiene imputación)
    partidaId: uuid('partida_id')
      .notNull()
      .references(() => partidas.id),

    insumoId: uuid('insumo_id').references(() => insumos.id),

    descripcion: varchar('descripcion', { length: 500 }).notNull(),

    cantidad: numeric('cantidad', { precision: 18, scale: 4 }).notNull(),

    unidadMedida: varchar('unidad_medida', { length: 20 }).notNull(),

    // Precio estimado para validar contra disponible
    precioEstimado: numeric('precio_estimado', { precision: 18, scale: 4 })
      .notNull()
      .default('0.0000'),

    moneda: varchar('moneda', { length: 3 }).notNull().default('DOP'),

    ...auditColumns,
  },
  (t) => ({
    tenantIdx: index('linea_req_tenant_id_idx').on(t.tenantId),
    requisicionIdx: index('linea_req_requisicion_id_idx').on(t.requisicionId),
    partidaIdx: index('linea_req_partida_id_idx').on(t.partidaId),
  }),
);

export type RequisicionInsert = typeof requisiciones.$inferInsert;
export type RequisicionSelect = typeof requisiciones.$inferSelect;
export type LineaRequisicionInsert = typeof lineasRequisicion.$inferInsert;
export type LineaRequisicionSelect = typeof lineasRequisicion.$inferSelect;
