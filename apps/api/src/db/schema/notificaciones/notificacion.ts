import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  timestamp,
  index,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { newId } from '@tributia/shared';
import { tenants } from '../core/tenant.js';
import { auditColumns } from '../core/audit.js';
import type { TipoNotificacion, CanalNotificacion } from '@tributia/documental';

/**
 * notificacion — registro de notificación enviada o pendiente de envío.
 *
 * Cada fila representa un evento de notificación para un usuario específico
 * en un canal específico. Para notificar por IN_APP + EMAIL se crean dos filas
 * (una por canal), preservando el historial completo de despacho.
 *
 * leida / leida_en solo aplica a canal IN_APP.
 * enviada_en se rellena cuando el canal confirma despacho exitoso.
 */
export const notificaciones = pgTable(
  'notificacion',
  {
    id: uuid('id').primaryKey().$defaultFn(() => newId()),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),

    usuarioId: uuid('usuario_id').notNull(),

    tipo: varchar('tipo', { length: 50 })
      .notNull()
      .$type<TipoNotificacion>(),

    canal: varchar('canal', { length: 20 })
      .notNull()
      .default('IN_APP')
      .$type<CanalNotificacion>(),

    asunto: varchar('asunto', { length: 500 }).notNull(),
    cuerpo: text('cuerpo').notNull(),

    referenciaTipo: varchar('referencia_tipo', { length: 100 }),
    referenciaId: uuid('referencia_id'),

    leida: boolean('leida').notNull().default(false),
    enviadaEn: timestamp('enviada_en', { withTimezone: true }),
    leidaEn: timestamp('leida_en', { withTimezone: true }),

    ...auditColumns,
  },
  (t) => ({
    usuarioIdx: index('notificacion_usuario_idx').on(t.tenantId, t.usuarioId, t.leida),
    tenantIdx: index('notificacion_tenant_idx').on(t.tenantId),
    tipoCheck: check(
      'notificacion_tipo_check',
      sql`${t.tipo} IN ('VENCIMIENTO_DOCUMENTO','FLUJO_APROBACION','SISTEMA')`,
    ),
    canalCheck: check(
      'notificacion_canal_check',
      sql`${t.canal} IN ('IN_APP','EMAIL','WHATSAPP')`,
    ),
  }),
);

export type NotificacionInsert = typeof notificaciones.$inferInsert;
export type NotificacionSelect = typeof notificaciones.$inferSelect;
