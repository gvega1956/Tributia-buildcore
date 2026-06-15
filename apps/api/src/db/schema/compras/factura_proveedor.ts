import {
  pgTable,
  uuid,
  varchar,
  text,
  numeric,
  date,
  boolean,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { newId } from '@tributia/shared';
import { tenants, empresas } from '../core/tenant.js';
import { terceros } from '../catalogos/tercero.js';
import { ordenesCompra, lineasOrdenCompra } from './orden_compra.js';
import { recepcionesOc } from './recepcion_oc.js';
import { eventosOperativos } from '../ledger/evento_operativo.js';
import { auditColumns, softDeleteColumns } from '../core/audit.js';

export const ESTADOS_MATCH = [
  'PENDIENTE',
  'OK',
  'DISCREPANCIA_PRECIO',
  'DISCREPANCIA_CANTIDAD',
  'EXCEPCION_APROBADA',
] as const;
export type EstadoMatch = (typeof ESTADOS_MATCH)[number];

export const ESTADOS_CXP_FACTURA = ['PENDIENTE', 'APROBADA', 'RECHAZADA'] as const;
export type EstadoCxpFactura = (typeof ESTADOS_CXP_FACTURA)[number];

export const facturasProveedor = pgTable(
  'factura_proveedor',
  {
    id: uuid('id').primaryKey().$defaultFn(() => newId()),

    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),

    empresaId: uuid('empresa_id')
      .notNull()
      .references(() => empresas.id),

    terceroId: uuid('tercero_id')
      .notNull()
      .references(() => terceros.id),

    // Vínculos al ciclo de compras (nullables — puede ser factura directa)
    ordenCompraId: uuid('orden_compra_id').references(() => ordenesCompra.id),
    recepcionOcId: uuid('recepcion_oc_id').references(() => recepcionesOc.id),

    numero: varchar('numero', { length: 30 }).notNull(),

    // NCF/e-CF tal como viene en la factura del proveedor (max 19 chars DGII)
    ncf: varchar('ncf', { length: 19 }).notNull(),

    // Código de tipo de e-CF detectado tras validación (E31, B01, etc.)
    tipoEcf: varchar('tipo_ecf', { length: 3 }),

    // true = el e-CF pasó la validación de localizacion-do
    ecfValidado: boolean('ecf_validado').notNull().default(false),

    fechaFactura: date('fecha_factura').notNull(),
    fechaVencimientoPago: date('fecha_vencimiento_pago'),

    montoSubtotal: numeric('monto_subtotal', { precision: 18, scale: 4 }).notNull(),
    montoItbis: numeric('monto_itbis', { precision: 18, scale: 4 }).notNull().default('0.0000'),
    montoTotal: numeric('monto_total', { precision: 18, scale: 4 }).notNull(),
    moneda: varchar('moneda', { length: 3 }).notNull().default('DOP'),

    // Estado del match de 3 vías: OC vs recepción vs factura
    estadoMatch: varchar('estado_match', { length: 30 })
      .notNull()
      .default('PENDIENTE')
      .$type<EstadoMatch>(),

    // Tolerancias configurables por factura (defaults: 2% precio, 5% cantidad)
    toleranciaPrecioPct: numeric('tolerancia_precio_pct', { precision: 5, scale: 2 })
      .notNull()
      .default('2.00'),
    toleranciaCantidadPct: numeric('tolerancia_cantidad_pct', { precision: 5, scale: 2 })
      .notNull()
      .default('5.00'),

    estadoCxp: varchar('estado_cxp', { length: 20 })
      .notNull()
      .default('PENDIENTE')
      .$type<EstadoCxpFactura>(),

    // FK al evento_operativo creado al registrar la factura
    eventoId: uuid('evento_id').references(() => eventosOperativos.id),

    notas: text('notas'),

    ...auditColumns,
    ...softDeleteColumns,
  },
  (t) => ({
    tenantIdx: index('fac_prov_tenant_idx').on(t.tenantId),
    terceroIdx: index('fac_prov_tercero_idx').on(t.terceroId),
    numeroUniq: uniqueIndex('fac_prov_tenant_numero_unique').on(t.tenantId, t.numero),
    ncfUniq: uniqueIndex('fac_prov_tenant_ncf_unique').on(t.tenantId, t.ncf),
    estadoMatchCheck: check(
      'fac_prov_estado_match_check',
      sql`${t.estadoMatch} IN ('PENDIENTE','OK','DISCREPANCIA_PRECIO','DISCREPANCIA_CANTIDAD','EXCEPCION_APROBADA')`,
    ),
    estadoCxpCheck: check(
      'fac_prov_estado_cxp_check',
      sql`${t.estadoCxp} IN ('PENDIENTE','APROBADA','RECHAZADA')`,
    ),
  }),
);

export const lineasFacturaProveedor = pgTable(
  'linea_factura_proveedor',
  {
    id: uuid('id').primaryKey().$defaultFn(() => newId()),

    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),

    facturaProveedorId: uuid('factura_proveedor_id')
      .notNull()
      .references(() => facturasProveedor.id),

    // Línea de OC relacionada (nullable para facturas directas)
    lineaOrdenCompraId: uuid('linea_orden_compra_id').references(() => lineasOrdenCompra.id),

    descripcion: varchar('descripcion', { length: 500 }).notNull(),
    cantidad: numeric('cantidad', { precision: 18, scale: 4 }).notNull(),
    precioUnitario: numeric('precio_unitario', { precision: 18, scale: 4 }).notNull(),
    itbis: numeric('itbis', { precision: 18, scale: 4 }).notNull().default('0.0000'),
    total: numeric('total', { precision: 18, scale: 4 }).notNull(),
    moneda: varchar('moneda', { length: 3 }).notNull().default('DOP'),

    ...auditColumns,
  },
  (t) => ({
    tenantIdx: index('linea_fac_prov_tenant_idx').on(t.tenantId),
    facturaIdx: index('linea_fac_prov_factura_idx').on(t.facturaProveedorId),
  }),
);

export type FacturaProveedorInsert = typeof facturasProveedor.$inferInsert;
export type FacturaProveedorSelect = typeof facturasProveedor.$inferSelect;
export type LineaFacturaProveedorInsert = typeof lineasFacturaProveedor.$inferInsert;
export type LineaFacturaProveedorSelect = typeof lineasFacturaProveedor.$inferSelect;
