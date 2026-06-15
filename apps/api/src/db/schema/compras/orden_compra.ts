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
import { terceros } from '../catalogos/tercero.js';
import { partidas } from '../proyectos/partida.js';
import { insumos } from '../catalogos/insumo.js';
import { cotizaciones } from './cotizacion.js';
import { auditColumns, softDeleteColumns } from '../core/audit.js';

export const ESTADOS_OC = [
  'BORRADOR',
  'PENDIENTE_APROBACION',
  'APROBADA',
  'RECHAZADA',
  'EMITIDA',
  'RECIBIDA_PARCIAL',
  'RECIBIDA_TOTAL',
  'CANCELADA',
] as const;
export type EstadoOc = (typeof ESTADOS_OC)[number];

export const ordenesCompra = pgTable(
  'orden_compra',
  {
    id: uuid('id').primaryKey().$defaultFn(() => newId()),

    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),

    empresaId: uuid('empresa_id')
      .notNull()
      .references(() => empresas.id),

    numero: varchar('numero', { length: 30 }).notNull(),

    estado: varchar('estado', { length: 30 })
      .notNull()
      .default('BORRADOR')
      .$type<EstadoOc>(),

    terceroId: uuid('tercero_id')
      .notNull()
      .references(() => terceros.id),

    // Cotización seleccionada como base (puede ser null si OC directa sin SOC)
    cotizacionId: uuid('cotizacion_id').references(() => cotizaciones.id),

    fechaEmision: date('fecha_emision'),

    fechaEntregaPrometida: date('fecha_entrega_prometida'),

    condicionesPago: varchar('condiciones_pago', { length: 200 }),

    totalMonto: numeric('total_monto', { precision: 18, scale: 4 })
      .notNull()
      .default('0.0000'),

    moneda: varchar('moneda', { length: 3 }).notNull().default('DOP'),

    notas: text('notas'),

    // FK a instancia de flujo de aprobación (workflow Capa 0)
    instanciaFlujoId: uuid('instancia_flujo_id'),

    // FK al evento_operativo creado al emitir la OC
    eventoEmisionId: uuid('evento_emision_id'),

    ...auditColumns,
    ...softDeleteColumns,
  },
  (t) => ({
    tenantIdx: index('oc_tenant_id_idx').on(t.tenantId),
    terceroIdx: index('oc_tercero_id_idx').on(t.terceroId),
    numeroUniq: uniqueIndex('oc_tenant_numero_unique').on(t.tenantId, t.numero),
    estadoCheck: check(
      'oc_estado_check',
      sql`${t.estado} IN ('BORRADOR','PENDIENTE_APROBACION','APROBADA','RECHAZADA','EMITIDA','RECIBIDA_PARCIAL','RECIBIDA_TOTAL','CANCELADA')`,
    ),
  }),
);

export const lineasOrdenCompra = pgTable(
  'linea_orden_compra',
  {
    id: uuid('id').primaryKey().$defaultFn(() => newId()),

    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),

    ordenCompraId: uuid('orden_compra_id')
      .notNull()
      .references(() => ordenesCompra.id),

    // Imputación obligatoria a partida (P3: todo costo tiene imputación)
    partidaId: uuid('partida_id')
      .notNull()
      .references(() => partidas.id),

    insumoId: uuid('insumo_id').references(() => insumos.id),

    descripcion: varchar('descripcion', { length: 500 }).notNull(),

    cantidad: numeric('cantidad', { precision: 18, scale: 4 }).notNull(),
    unidadMedida: varchar('unidad_medida', { length: 20 }).notNull(),
    precioUnitario: numeric('precio_unitario', { precision: 18, scale: 4 }).notNull(),
    total: numeric('total', { precision: 18, scale: 4 }).notNull(),
    moneda: varchar('moneda', { length: 3 }).notNull().default('DOP'),

    ...auditColumns,
  },
  (t) => ({
    tenantIdx: index('linea_oc_tenant_id_idx').on(t.tenantId),
    ocIdx: index('linea_oc_orden_compra_id_idx').on(t.ordenCompraId),
    partidaIdx: index('linea_oc_partida_id_idx').on(t.partidaId),
  }),
);

export type OrdenCompraInsert = typeof ordenesCompra.$inferInsert;
export type OrdenCompraSelect = typeof ordenesCompra.$inferSelect;
export type LineaOrdenCompraInsert = typeof lineasOrdenCompra.$inferInsert;
export type LineaOrdenCompraSelect = typeof lineasOrdenCompra.$inferSelect;
