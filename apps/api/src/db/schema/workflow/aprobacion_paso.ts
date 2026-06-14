import {
  pgTable,
  uuid,
  varchar,
  integer,
  text,
  timestamp,
  index,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { newId } from '@tributia/shared';
import { tenants } from '../core/tenant.js';
import { instanciasFlujo } from './instancia_flujo.js';
import { pasosFlujo } from './paso_flujo.js';
import { auditColumns } from '../core/audit.js';

/**
 * aprobacion_paso — tarea concreta de aprobación asignada a un usuario.
 *
 * Cada fila = "el usuario X debe aprobar el paso Y de la instancia Z".
 * Cuando se delega, la fila original queda como DELEGADO y se crea una nueva
 * con delegadoPor = usuario_original. Esto preserva la cadena de custodia.
 *
 * Estado de la máquina:
 *   PENDIENTE → APROBADO   (usuario aprueba)
 *   PENDIENTE → RECHAZADO  (usuario rechaza → toda la instancia pasa a RECHAZADO)
 *   PENDIENTE → DELEGADO   (usuario delega; nueva fila PENDIENTE para el delegado)
 *   PENDIENTE → VENCIDO    (job de vencimientos marca; si hay escalacion → nueva fila PENDIENTE)
 *
 * Esta tabla es el registro de auditoría completo de quién hizo qué y cuándo.
 */
export const aprobacionesPaso = pgTable(
  'aprobacion_paso',
  {
    id: uuid('id').primaryKey().$defaultFn(() => newId()),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    instanciaId: uuid('instancia_id').notNull().references(() => instanciasFlujo.id),
    pasoFlujoId: uuid('paso_flujo_id').notNull().references(() => pasosFlujo.id),

    // Denormalizado para facilitar consultas de "todos los pasos en orden X".
    ordenPaso: integer('orden_paso').notNull(),

    aprobadorId: uuid('aprobador_id').notNull(),
    // UUID del usuario que delegó esta aprobación. Null = no delegada.
    delegadoPor: uuid('delegado_por'),

    estado: varchar('estado', { length: 20 }).notNull().default('PENDIENTE')
      .$type<'PENDIENTE' | 'APROBADO' | 'RECHAZADO' | 'DELEGADO' | 'VENCIDO'>(),

    comentario: text('comentario'),
    respondidoEn: timestamp('respondido_en', { withTimezone: true }),
    venceEn: timestamp('vence_en', { withTimezone: true }),

    ...auditColumns,
  },
  (t) => ({
    instanciaIdx: index('aprobacion_instancia_idx').on(t.instanciaId),
    aprobadorIdx: index('aprobacion_aprobador_idx').on(t.aprobadorId, t.estado),
    tenantIdx: index('aprobacion_tenant_idx').on(t.tenantId),
    estadoCheck: check(
      'aprobacion_paso_estado_check',
      sql`${t.estado} IN ('PENDIENTE','APROBADO','RECHAZADO','DELEGADO','VENCIDO')`,
    ),
  }),
);

export type AprobacionPasoInsert = typeof aprobacionesPaso.$inferInsert;
export type AprobacionPasoSelect = typeof aprobacionesPaso.$inferSelect;
