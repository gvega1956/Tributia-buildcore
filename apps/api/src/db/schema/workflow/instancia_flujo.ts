import {
  pgTable,
  uuid,
  varchar,
  integer,
  text,
  numeric,
  timestamp,
  jsonb,
  index,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { newId } from '@tributia/shared';
import { tenants } from '../core/tenant.js';
import { tiposFlujo } from './tipo_flujo.js';
import { auditColumns } from '../core/audit.js';

/**
 * instancia_flujo — ejecución concreta de un tipo_flujo para un documento.
 *
 * Estado de la máquina:
 *   EN_PROGRESO → APROBADO  (todos los pasos aprobados)
 *   EN_PROGRESO → RECHAZADO (cualquier paso rechazado)
 *   EN_PROGRESO → CANCELADO (cancelado por el iniciador o admin)
 *
 * `paso_actual` refleja el orden que está procesándose actualmente.
 * `documento_id` + `documento_tabla` apuntan al documento que espera aprobación.
 * `metadata` almacena contexto adicional del módulo iniciador (ej: nro. OC, proyecto).
 */
export const instanciasFlujo = pgTable(
  'instancia_flujo',
  {
    id: uuid('id').primaryKey().$defaultFn(() => newId()),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    tipoFlujoId: uuid('tipo_flujo_id').notNull().references(() => tiposFlujo.id),

    tipoDocumento: varchar('tipo_documento', { length: 50 }).notNull(),
    documentoId: uuid('documento_id').notNull(),
    documentoTabla: varchar('documento_tabla', { length: 100 }).notNull(),

    monto: numeric('monto', { precision: 18, scale: 4 }),
    moneda: varchar('moneda', { length: 3 }),

    iniciadoPor: uuid('iniciado_por').notNull(),
    estado: varchar('estado', { length: 20 }).notNull().default('EN_PROGRESO')
      .$type<'EN_PROGRESO' | 'APROBADO' | 'RECHAZADO' | 'CANCELADO'>(),

    pasoActual: integer('paso_actual').notNull().default(1),
    descripcion: text('descripcion').notNull(),
    metadata: jsonb('metadata'),

    finalizadoEn: timestamp('finalizado_en', { withTimezone: true }),

    ...auditColumns,
  },
  (t) => ({
    tenantIdx: index('instancia_flujo_tenant_idx').on(t.tenantId),
    documentoIdx: index('instancia_flujo_documento_idx').on(t.documentoId, t.tipoDocumento),
    estadoIdx: index('instancia_flujo_estado_idx').on(t.tenantId, t.estado),
    estadoCheck: check(
      'instancia_flujo_estado_check',
      sql`${t.estado} IN ('EN_PROGRESO','APROBADO','RECHAZADO','CANCELADO')`,
    ),
  }),
);

export type InstanciaFlujoInsert = typeof instanciasFlujo.$inferInsert;
export type InstanciaFlujoSelect = typeof instanciasFlujo.$inferSelect;
