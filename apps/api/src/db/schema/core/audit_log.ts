import {
  pgTable,
  uuid,
  varchar,
  text,
  jsonb,
  timestamp,
  index,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { tenants } from './tenant.js';

/**
 * audit_log — bitácora inmutable de cambios en tablas sensibles (P8).
 *
 * Escrita ÚNICAMENTE por triggers SECURITY DEFINER (no por la aplicación).
 * tributia_app tiene solo SELECT — no puede insertar, modificar ni borrar entradas.
 *
 * Captura: quién (usuario_id), cuándo (created_at), desde dónde (ip_address,
 * user_agent), qué tabla, qué registro, y el diff de campos cambiados.
 *
 * SIN RLS — el trigger corre como superuser/owner para escribir aquí
 * independientemente del contexto del request.
 */
export const auditLogs = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').references(() => tenants.id),
    tablaNombre: varchar('tabla_nombre', { length: 100 }).notNull(),
    registroId: uuid('registro_id').notNull(),
    operacion: varchar('operacion', { length: 10 })
      .notNull()
      .$type<'INSERT' | 'UPDATE' | 'DELETE'>(),
    usuarioId: uuid('usuario_id'),
    ipAddress: varchar('ip_address', { length: 45 }),
    userAgent: text('user_agent'),
    datosAnteriores: jsonb('datos_anteriores'),
    datosNuevos: jsonb('datos_nuevos'),
    diff: jsonb('diff'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    tenantIdx: index('audit_log_tenant_id_idx').on(t.tenantId),
    tablaRegistroIdx: index('audit_log_tabla_registro_idx').on(t.tablaNombre, t.registroId),
    usuarioIdx: index('audit_log_usuario_id_idx').on(t.usuarioId),
    createdAtIdx: index('audit_log_created_at_idx').on(t.createdAt),
    operacionCheck: check(
      'audit_log_operacion_check',
      sql`${t.operacion} IN ('INSERT', 'UPDATE', 'DELETE')`,
    ),
  }),
);

export type AuditLogInsert = typeof auditLogs.$inferInsert;
export type AuditLogSelect = typeof auditLogs.$inferSelect;
