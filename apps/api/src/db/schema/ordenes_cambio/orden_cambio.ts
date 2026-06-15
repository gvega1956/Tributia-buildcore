import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  numeric,
  timestamp,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { newId } from '@tributia/shared';
import { tenants, empresas } from '../core/tenant.js';
import { proyectos } from '../proyectos/proyecto.js';
import { eventosOperativos } from '../ledger/evento_operativo.js';
import { auditColumns } from '../core/audit.js';

export const CAUSAS_ORDEN_CAMBIO = ['CLIENTE', 'DISENO', 'CAMPO', 'IMPREVISTO'] as const;
export type CausaOrdenCambio = (typeof CAUSAS_ORDEN_CAMBIO)[number];

export const ESTADOS_ORDEN_CAMBIO = [
  'BORRADOR',
  'ENVIADO_CLIENTE',
  'APROBADO',
  'RECHAZADO',
  'ANULADO',
] as const;
export type EstadoOrdenCambio = (typeof ESTADOS_ORDEN_CAMBIO)[number];

/**
 * orden_cambio — Change Order (§9 arquitectura.md).
 *
 * Flujo: BORRADOR → ENVIADO_CLIENTE → APROBADO | RECHAZADO
 *
 * Al aprobarse emite evento `orden_cambio_aprobada` que proyecta
 * las diferencias al presupuesto vigente via ejecucion_partida.
 *
 * REGLA DE ORO: trabajo sin cobertura en presupuesto vigente dispara alerta
 * que fuerza el flujo de OC (detectado en ObraAvancePartidaHandler).
 */
export const ordenCambios = pgTable(
  'orden_cambio',
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

    numero: integer('numero').notNull(),

    causa: varchar('causa', { length: 20 })
      .notNull()
      .$type<CausaOrdenCambio>(),

    descripcion: text('descripcion').notNull(),

    estado: varchar('estado', { length: 30 })
      .notNull()
      .default('BORRADOR')
      .$type<EstadoOrdenCambio>(),

    montoEstimado: numeric('monto_estimado', { precision: 18, scale: 4 })
      .notNull()
      .default('0.0000'),

    montoAprobado: numeric('monto_aprobado', { precision: 18, scale: 4 }),

    diasAdicionalesSolicitados: integer('dias_adicionales_solicitados'),
    diasAdicionalesAprobados: integer('dias_adicionales_aprobados'),

    aprobadoPor: uuid('aprobado_por'),
    aprobadoEn: timestamp('aprobado_en', { withTimezone: true }),

    rechazadoPor: uuid('rechazado_por'),
    razonRechazo: text('razon_rechazo'),

    // FK al evento ledger — seteado al aprobarse
    eventoId: uuid('evento_id').references(() => eventosOperativos.id),

    ...auditColumns,
  },
  (t) => ({
    tenantIdx: index('oc_tenant_id_idx').on(t.tenantId),
    proyectoIdx: index('oc_proyecto_id_idx').on(t.proyectoId),
    proyectoNumeroUniq: uniqueIndex('oc_proyecto_numero_unique').on(
      t.proyectoId,
      t.numero,
    ),
    causaCheck: check(
      'oc_causa_check',
      sql`${t.causa} IN ('CLIENTE','DISENO','CAMPO','IMPREVISTO')`,
    ),
    estadoCheck: check(
      'oc_estado_check',
      sql`${t.estado} IN ('BORRADOR','ENVIADO_CLIENTE','APROBADO','RECHAZADO','ANULADO')`,
    ),
  }),
);

export type OrdenCambioInsert = typeof ordenCambios.$inferInsert;
export type OrdenCambioSelect = typeof ordenCambios.$inferSelect;
