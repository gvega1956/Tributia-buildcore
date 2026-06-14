import {
  pgTable,
  uuid,
  varchar,
  jsonb,
  timestamp,
  integer,
  text,
  index,
  check,
  unique,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { newId } from '@tributia/shared';
import { tenants } from '../core/tenant.js';
import { eventosOperativos } from './evento_operativo.js';

/**
 * outbox — patrón transactional outbox para proyecciones asíncronas (P2).
 *
 * Cada fila representa una ejecución pendiente de un handler asíncrono
 * sobre un evento del ledger. Se inserta en la MISMA transacción que el
 * evento (atomicidad garantizada: si el evento se revierte, la entrada
 * outbox también desaparece).
 *
 * Garantías:
 *  - At-least-once: el worker reintenta hasta max_intentos.
 *  - Idempotencia: UNIQUE(evento_id, handler_nombre) previene duplicados.
 *  - Dead-letter: cuando intentos >= max_intentos → estado = 'fallido'.
 *
 * SIN RLS: el worker necesita leer entradas de todos los tenants.
 * tributia_app tiene INSERT, SELECT, UPDATE (para marcar estado dentro del handler tx).
 */
export const outbox = pgTable(
  'outbox',
  {
    id: uuid('id').primaryKey().$defaultFn(() => newId()),

    eventoId: uuid('evento_id')
      .notNull()
      .references(() => eventosOperativos.id),

    handlerNombre: varchar('handler_nombre', { length: 100 }).notNull(),

    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),

    // Snapshot completo del evento al momento de encolar (worker no necesita JOIN).
    payload: jsonb('payload').notNull(),

    estado: varchar('estado', { length: 20 })
      .notNull()
      .default('pendiente'),

    intentos: integer('intentos').notNull().default(0),
    maxIntentos: integer('max_intentos').notNull().default(5),

    // Cuándo intentar la próxima ejecución (backoff exponencial).
    proximoIntentoEn: timestamp('proximo_intento_en', { withTimezone: true })
      .notNull()
      .default(sql`now()`),

    errorUltimo: text('error_ultimo'),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),

    procesadoEn: timestamp('procesado_en', { withTimezone: true }),
  },
  (t) => ({
    eventoHandlerUniq: unique('outbox_evento_handler_unique').on(t.eventoId, t.handlerNombre),

    estadoProximoIdx: index('outbox_estado_proximo_idx').on(t.estado, t.proximoIntentoEn),
    tenantIdx: index('outbox_tenant_id_idx').on(t.tenantId),

    estadoCheck: check(
      'outbox_estado_check',
      sql`${t.estado} IN ('pendiente','procesando','completado','fallido')`,
    ),
  }),
);

export type OutboxInsert = typeof outbox.$inferInsert;
export type OutboxSelect = typeof outbox.$inferSelect;
