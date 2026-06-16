import {
  pgTable,
  uuid,
  varchar,
  jsonb,
  timestamp,
  text,
  uniqueIndex,
  index,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { newId } from '@tributia/shared';
import { tenants, empresas } from '../core/tenant.js';

export const TIPOS_OPERACION_SYNC = [
  'consumo_material',
  'avance_partida',
  'hora_personal',
  'hora_equipo',
] as const;
export type TipoOperacionSync = (typeof TIPOS_OPERACION_SYNC)[number];

export const ESTADOS_COLA_SYNC = [
  'PENDIENTE_EJECUCION',
  'PROCESADO',
  'CONFLICTO',
  'ERROR',
  'ANULADO_POR_CONFLICTO',
] as const;
export type EstadoColaSync = (typeof ESTADOS_COLA_SYNC)[number];

export const ROLES_SYNC = ['ADMIN', 'RESIDENTE', 'ALMACENISTA', 'OPERARIO'] as const;
export type RolSync = (typeof ROLES_SYNC)[number];

/**
 * Prioridad numérica de roles para la resolución de conflictos de avance.
 * Mayor número = mayor prioridad. ADMIN siempre gana.
 */
export const ROL_PRIORIDAD: Record<RolSync, number> = {
  ADMIN: 4,
  RESIDENTE: 3,
  ALMACENISTA: 2,
  OPERARIO: 1,
};

/**
 * cola_sincronizacion — cola de operaciones capturadas offline (P7).
 *
 * Idempotencia: (tenant_id, idempotency_key) UNIQUE.
 * Conflictos de avance_partida: gana el rol de mayor prioridad.
 * Operaciones aditivas (consumo, horas): nunca conflicto, siempre PENDIENTE_EJECUCION.
 */
export const colaSincronizacion = pgTable(
  'cola_sincronizacion',
  {
    id: uuid('id').primaryKey().$defaultFn(() => newId()),

    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),

    empresaId: uuid('empresa_id')
      .notNull()
      .references(() => empresas.id),

    usuarioId: uuid('usuario_id').notNull(),

    rolUsuario: varchar('rol_usuario', { length: 30 })
      .notNull()
      .$type<RolSync>(),

    dispositivoId: varchar('dispositivo_id', { length: 100 }).notNull(),

    tipoOperacion: varchar('tipo_operacion', { length: 50 })
      .notNull()
      .$type<TipoOperacionSync>(),

    payload: jsonb('payload').notNull().$type<Record<string, unknown>>(),

    ocurridoEn: timestamp('ocurrido_en', { withTimezone: true }).notNull(),

    idempotencyKey: varchar('idempotency_key', { length: 255 }).notNull(),

    estado: varchar('estado', { length: 30 })
      .notNull()
      .default('PENDIENTE_EJECUCION')
      .$type<EstadoColaSync>(),

    conflictoConId: uuid('conflicto_con_id'),

    conflictoDetalle: text('conflicto_detalle'),

    eventoLedgerId: uuid('evento_ledger_id'),

    procesadoEn: timestamp('procesado_en', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),

    createdBy: uuid('created_by').notNull(),

    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),

    updatedBy: uuid('updated_by').notNull().default('00000000-0000-7000-0000-000000000000'),
  },
  (t) => ({
    idempotencyUniq: uniqueIndex('cola_sync_idempotency_uniq').on(t.tenantId, t.idempotencyKey),
    tenantIdx: index('cola_sync_tenant_idx').on(t.tenantId),
    estadoIdx: index('cola_sync_estado_idx').on(t.estado),
    dispositivoIdx: index('cola_sync_dispositivo_idx').on(t.tenantId, t.dispositivoId),
    tipoCheck: check(
      'cola_sync_tipo_operacion_check',
      sql`${t.tipoOperacion} IN ('consumo_material','avance_partida','hora_personal','hora_equipo')`,
    ),
    estadoCheck: check(
      'cola_sync_estado_check',
      sql`${t.estado} IN ('PENDIENTE_EJECUCION','PROCESADO','CONFLICTO','ERROR','ANULADO_POR_CONFLICTO')`,
    ),
    rolCheck: check(
      'cola_sync_rol_check',
      sql`${t.rolUsuario} IN ('ADMIN','RESIDENTE','ALMACENISTA','OPERARIO')`,
    ),
  }),
);

export type ColaSincronizacionInsert = typeof colaSincronizacion.$inferInsert;
export type ColaSincronizacionSelect = typeof colaSincronizacion.$inferSelect;
