import {
  pgTable,
  uuid,
  varchar,
  boolean,
  numeric,
  date,
  jsonb,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { newId } from '@tributia/shared';
import { tenants, empresas } from '../core/tenant.js';
import { proyectos } from '../proyectos/proyecto.js';
import { facturasCliente } from '../cxc/factura_cliente.js';
import { eventosOperativos } from '../ledger/evento_operativo.js';
import { auditColumns, softDeleteColumns } from '../core/audit.js';

export const TIPOS_ECF_VENTA = ['E31', 'E32', 'E33', 'E34'] as const;
export type TipoEcfVenta = (typeof TIPOS_ECF_VENTA)[number];

export const ESTADOS_COMPROBANTE_ECF = ['ACEPTADO', 'RECHAZADO', 'CONTINGENCIA'] as const;
export type EstadoComprobanteEcf = (typeof ESTADOS_COMPROBANTE_ECF)[number];

/**
 * comprobante_ecf — e-CF de venta emitido (ADR-0007).
 *
 * `documento` guarda la estructura completa construida por
 * `construirComprobanteEcf()` (packages/localizacion-do) — lo transmitido al
 * middleware. `comprobante_origen_id` es la referencia verificable en BD que
 * usan los tipos 33/34 (nota de débito/crédito) hacia el e-CF que modifican.
 *
 * Si `en_contingencia` es true, no hubo acuse_ecf todavía — el comprobante se
 * emitió con una Representación Impresa (campos ri_*) mientras se regulariza
 * dentro de `ri_fecha_limite_regularizacion`.
 */
export const comprobantesEcf = pgTable(
  'comprobante_ecf',
  {
    id: uuid('id').primaryKey().$defaultFn(() => newId()),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    empresaId: uuid('empresa_id').notNull().references(() => empresas.id),
    proyectoId: uuid('proyecto_id').notNull().references(() => proyectos.id),

    // Nullable: los ajustes (33/34) no siempre nacen de una factura_cliente propia.
    facturaClienteId: uuid('factura_cliente_id').references(() => facturasCliente.id),

    tipoEcf: varchar('tipo_ecf', { length: 3 }).notNull().$type<TipoEcfVenta>(),
    ncf: varchar('ncf', { length: 19 }).notNull(),

    estado: varchar('estado', { length: 20 })
      .notNull()
      .default('ACEPTADO')
      .$type<EstadoComprobanteEcf>(),

    // Self-FK — obligatoria a nivel de aplicación para tipos 33/34 (ver ecf-builder.ts).
    comprobanteOrigenId: uuid('comprobante_origen_id').references((): AnyPgColumn => comprobantesEcf.id),

    documento: jsonb('documento').notNull(),
    hashIntegridad: varchar('hash_integridad', { length: 64 }).notNull(),

    enContingencia: boolean('en_contingencia').notNull().default(false),
    riNumero: varchar('ri_numero', { length: 50 }),
    riCodigoSeguridad: varchar('ri_codigo_seguridad', { length: 20 }),
    riFechaLimiteRegularizacion: date('ri_fecha_limite_regularizacion'),

    montoSubtotal: numeric('monto_subtotal', { precision: 18, scale: 4 }).notNull(),
    montoItbis: numeric('monto_itbis', { precision: 18, scale: 4 }).notNull().default('0.0000'),
    montoTotal: numeric('monto_total', { precision: 18, scale: 4 }).notNull(),
    moneda: varchar('moneda', { length: 3 }).notNull().default('DOP'),

    fechaEmision: date('fecha_emision').notNull(),
    retenerHasta: date('retener_hasta').notNull(),

    eventoId: uuid('evento_id').references(() => eventosOperativos.id),

    ...auditColumns,
    ...softDeleteColumns,
  },
  (t) => ({
    tenantIdx: index('comprobante_ecf_tenant_idx').on(t.tenantId),
    facturaIdx: index('comprobante_ecf_factura_idx').on(t.facturaClienteId),
    origenIdx: index('comprobante_ecf_origen_idx').on(t.comprobanteOrigenId),
    ncfUniq: uniqueIndex('comprobante_ecf_tenant_ncf_unique').on(t.tenantId, t.ncf),
    tipoCheck: check('comprobante_ecf_tipo_check', sql`${t.tipoEcf} IN ('E31','E32','E33','E34')`),
    estadoCheck: check(
      'comprobante_ecf_estado_check',
      sql`${t.estado} IN ('ACEPTADO','RECHAZADO','CONTINGENCIA')`,
    ),
  }),
);

export type ComprobanteEcfInsert = typeof comprobantesEcf.$inferInsert;
export type ComprobanteEcfSelect = typeof comprobantesEcf.$inferSelect;
