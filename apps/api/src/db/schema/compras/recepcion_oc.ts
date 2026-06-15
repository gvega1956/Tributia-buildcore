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
import { ordenesCompra, lineasOrdenCompra } from './orden_compra.js';
import { almacenes } from '../inventario/almacen.js';
import { insumos } from '../catalogos/insumo.js';
import { partidas } from '../proyectos/partida.js';
import { eventosOperativos } from '../ledger/evento_operativo.js';
import { auditColumns, softDeleteColumns } from '../core/audit.js';

export const ESTADOS_RECEPCION_OC = ['BORRADOR', 'CONFIRMADA', 'CANCELADA'] as const;
export type EstadoRecepcionOc = (typeof ESTADOS_RECEPCION_OC)[number];

export const recepcionesOc = pgTable(
  'recepcion_oc',
  {
    id: uuid('id').primaryKey().$defaultFn(() => newId()),

    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),

    empresaId: uuid('empresa_id')
      .notNull()
      .references(() => empresas.id),

    ordenCompraId: uuid('orden_compra_id')
      .notNull()
      .references(() => ordenesCompra.id),

    numero: varchar('numero', { length: 30 }).notNull(),

    // Número de conduce / albarán del proveedor
    conduce: varchar('conduce', { length: 50 }),

    fechaRecepcion: date('fecha_recepcion').notNull(),

    almacenId: uuid('almacen_id')
      .notNull()
      .references(() => almacenes.id),

    estado: varchar('estado', { length: 20 })
      .notNull()
      .default('BORRADOR')
      .$type<EstadoRecepcionOc>(),

    // FK al archivo del conduce (foto o PDF cargado)
    archivoConduceId: uuid('archivo_conduce_id'),

    // FK al evento_operativo generado al confirmar la recepción
    eventoRecepcionId: uuid('evento_recepcion_id').references(() => eventosOperativos.id),

    notas: text('notas'),

    ...auditColumns,
    ...softDeleteColumns,
  },
  (t) => ({
    tenantIdx: index('rec_oc_tenant_id_idx').on(t.tenantId),
    ocIdx: index('rec_oc_orden_compra_id_idx').on(t.ordenCompraId),
    numeroUniq: uniqueIndex('rec_oc_tenant_numero_unique').on(t.tenantId, t.numero),
    estadoCheck: check(
      'rec_oc_estado_check',
      sql`${t.estado} IN ('BORRADOR','CONFIRMADA','CANCELADA')`,
    ),
  }),
);

export const lineasRecepcionOc = pgTable(
  'linea_recepcion_oc',
  {
    id: uuid('id').primaryKey().$defaultFn(() => newId()),

    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),

    recepcionOcId: uuid('recepcion_oc_id')
      .notNull()
      .references(() => recepcionesOc.id),

    lineaOrdenCompraId: uuid('linea_orden_compra_id')
      .notNull()
      .references(() => lineasOrdenCompra.id),

    // Desnormalizado para facilitar handlers de inventario
    insumoId: uuid('insumo_id').references(() => insumos.id),

    // Imputación obligatoria (P3)
    partidaId: uuid('partida_id')
      .notNull()
      .references(() => partidas.id),

    cantidadRecibida: numeric('cantidad_recibida', { precision: 18, scale: 4 }).notNull(),
    costoUnitario: numeric('costo_unitario', { precision: 18, scale: 4 }).notNull(),
    moneda: varchar('moneda', { length: 3 }).notNull().default('DOP'),

    observacion: varchar('observacion', { length: 500 }),

    ...auditColumns,
  },
  (t) => ({
    tenantIdx: index('linea_rec_oc_tenant_idx').on(t.tenantId),
    recepcionIdx: index('linea_rec_oc_recepcion_idx').on(t.recepcionOcId),
    lineaOcIdx: index('linea_rec_oc_linea_oc_idx').on(t.lineaOrdenCompraId),
  }),
);

export type RecepcionOcInsert = typeof recepcionesOc.$inferInsert;
export type RecepcionOcSelect = typeof recepcionesOc.$inferSelect;
export type LineaRecepcionOcInsert = typeof lineasRecepcionOc.$inferInsert;
export type LineaRecepcionOcSelect = typeof lineasRecepcionOc.$inferSelect;

// Re-export almacenId para uso en handlers
export { timestamp };
