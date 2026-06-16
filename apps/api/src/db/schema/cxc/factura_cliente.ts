import { pgTable, uuid, varchar, date, numeric, index, uniqueIndex, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { newId } from '@tributia/shared';
import { tenants, empresas } from '../core/tenant.js';
import { proyectos } from '../proyectos/proyecto.js';
import { terceros } from '../catalogos/tercero.js';
import { cubicaciones } from './cubicacion.js';
import { eventosOperativos } from '../ledger/evento_operativo.js';
import { auditColumns, softDeleteColumns } from '../core/audit.js';

export const ESTADOS_FACTURA_CLIENTE = ['EMITIDA', 'ANULADA'] as const;
export type EstadoFacturaCliente = (typeof ESTADOS_FACTURA_CLIENTE)[number];

/**
 * factura_cliente — factura emitida al cliente desde una cubicación (§16).
 *
 * Las retenciones (isr/itbis) se calculan por RetencionClienteService según
 * el tipo de tercero (Estado vs. privado) usando el catálogo `tipo_retencion`
 * de Capa 0 — nunca un porcentaje hardcodeado aquí.
 *
 * Al emitirse dispara el evento `emision_factura_cliente`, cuyo handler
 * (REQUERIDO) genera el asiento contable y la cuenta_por_cobrar.
 */
export const facturasCliente = pgTable(
  'factura_cliente',
  {
    id: uuid('id').primaryKey().$defaultFn(() => newId()),

    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),

    empresaId: uuid('empresa_id')
      .notNull()
      .references(() => empresas.id),

    proyectoId: uuid('proyecto_id')
      .notNull()
      .references(() => proyectos.id),

    clienteId: uuid('cliente_id')
      .notNull()
      .references(() => terceros.id),

    cubicacionId: uuid('cubicacion_id')
      .notNull()
      .references(() => cubicaciones.id),

    numero: varchar('numero', { length: 30 }).notNull(),

    // NCF propio emitido a través de localizacion-do — nullable: e-CF puede generarse después
    ncf: varchar('ncf', { length: 19 }),

    fechaEmision: date('fecha_emision').notNull(),

    montoSubtotal: numeric('monto_subtotal', { precision: 18, scale: 4 }).notNull(),
    montoItbis: numeric('monto_itbis', { precision: 18, scale: 4 }).notNull().default('0.0000'),
    montoRetencionIsr: numeric('monto_retencion_isr', { precision: 18, scale: 4 })
      .notNull()
      .default('0.0000'),
    montoRetencionItbis: numeric('monto_retencion_itbis', { precision: 18, scale: 4 })
      .notNull()
      .default('0.0000'),
    montoTotal: numeric('monto_total', { precision: 18, scale: 4 }).notNull(),
    // total - retenciones: lo que el cliente efectivamente paga
    montoNetoACobrar: numeric('monto_neto_a_cobrar', { precision: 18, scale: 4 }).notNull(),
    moneda: varchar('moneda', { length: 3 }).notNull().default('DOP'),

    estado: varchar('estado', { length: 20 })
      .notNull()
      .default('EMITIDA')
      .$type<EstadoFacturaCliente>(),

    // FK al evento_operativo emision_factura_cliente
    eventoId: uuid('evento_id').references(() => eventosOperativos.id),

    ...auditColumns,
    ...softDeleteColumns,
  },
  (t) => ({
    tenantIdx: index('fac_cli_tenant_idx').on(t.tenantId),
    proyectoIdx: index('fac_cli_proyecto_idx').on(t.proyectoId),
    clienteIdx: index('fac_cli_cliente_idx').on(t.clienteId),
    numeroUniq: uniqueIndex('fac_cli_tenant_numero_unique').on(t.tenantId, t.numero),
    cubicacionUniq: uniqueIndex('fac_cli_cubicacion_unique').on(t.cubicacionId),
    estadoCheck: check('fac_cli_estado_check', sql`${t.estado} IN ('EMITIDA','ANULADA')`),
  }),
);

export type FacturaClienteInsert = typeof facturasCliente.$inferInsert;
export type FacturaClienteSelect = typeof facturasCliente.$inferSelect;
