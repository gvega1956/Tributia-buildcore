import {
  pgTable,
  uuid,
  varchar,
  text,
  date,
  numeric,
  uniqueIndex,
  index,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { newId } from '@tributia/shared';
import { tenants, empresas } from '../core/tenant.js';
import { proyectos } from '../proyectos/proyecto.js';
import { auditColumns, softDeleteColumns } from '../core/audit.js';

export const CLIMAS = ['SOLEADO', 'NUBLADO', 'PARCIALMENTE_NUBLADO', 'LLUVIOSO', 'TORMENTA'] as const;
export type Clima = (typeof CLIMAS)[number];

export const ESTADOS_PARTE = ['BORRADOR', 'CONFIRMADO'] as const;
export type EstadoParte = (typeof ESTADOS_PARTE)[number];

/**
 * parte_diario — registro del hecho operativo diario en obra.
 *
 * Un solo parte diario alimenta avance físico, costo de MO y costo de equipos
 * cuando se confirma (estado BORRADOR → CONFIRMADO emite los eventos del ledger).
 *
 * idempotency_key permite sincronización segura desde la app móvil offline:
 * si el mismo key llega dos veces, se retorna el registro existente sin duplicar.
 */
export const partesDiario = pgTable(
  'parte_diario',
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

    fecha: date('fecha').notNull(),

    clima: varchar('clima', { length: 30 }).$type<Clima>(),

    temperaturaC: numeric('temperatura_c', { precision: 5, scale: 2 }),

    estado: varchar('estado', { length: 20 })
      .notNull()
      .default('BORRADOR')
      .$type<EstadoParte>(),

    notas: text('notas'),

    idempotencyKey: varchar('idempotency_key', { length: 100 }).notNull(),

    ...auditColumns,
    ...softDeleteColumns,
  },
  (t) => ({
    tenantIdx: index('parte_diario_tenant_idx').on(t.tenantId),
    proyectoIdx: index('parte_diario_proyecto_idx').on(t.proyectoId),
    fechaIdx: index('parte_diario_fecha_idx').on(t.tenantId, t.proyectoId, t.fecha),
    idempotencyUniq: uniqueIndex('parte_diario_idempotency_unique').on(t.tenantId, t.idempotencyKey),
    estadoCheck: check(
      'parte_diario_estado_check',
      sql`${t.estado} IN ('BORRADOR','CONFIRMADO')`,
    ),
    climaCheck: check(
      'parte_diario_clima_check',
      sql`${t.clima} IS NULL OR ${t.clima} IN ('SOLEADO','NUBLADO','PARCIALMENTE_NUBLADO','LLUVIOSO','TORMENTA')`,
    ),
  }),
);

export type ParteDiarioInsert = typeof partesDiario.$inferInsert;
export type ParteDiarioSelect = typeof partesDiario.$inferSelect;
