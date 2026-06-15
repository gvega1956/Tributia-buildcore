import {
  pgTable,
  uuid,
  varchar,
  numeric,
  uniqueIndex,
  index,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { newId } from '@tributia/shared';
import { tenants } from '../core/tenant.js';
import { partesDiario } from './parte_diario.js';
import { partidas } from '../proyectos/partida.js';
import { auditColumns } from '../core/audit.js';

export const TIPOS_PERSONAL = ['PROPIO', 'SUBCONTRATADO'] as const;
export type TipoPersonal = (typeof TIPOS_PERSONAL)[number];

/**
 * personal_parte — mano de obra presente en el parte diario, por partida.
 *
 * Cada fila = un trabajador (o cuadrilla homogénea) asignado a una partida
 * con sus horas y tarifa. Al confirmar el parte se emite un evento hora_personal
 * por fila → el handler imputa costoTotal a ejecucion_partida.devengado.
 *
 * idempotency_key garantiza que reenvíos móviles no generen eventos duplicados.
 */
export const personalParte = pgTable(
  'personal_parte',
  {
    id: uuid('id').primaryKey().$defaultFn(() => newId()),

    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),

    parteId: uuid('parte_id')
      .notNull()
      .references(() => partesDiario.id),

    nombre: varchar('nombre', { length: 200 }).notNull(),

    empleadoId: uuid('empleado_id'),

    tipo: varchar('tipo', { length: 20 })
      .notNull()
      .default('PROPIO')
      .$type<TipoPersonal>(),

    horasTrabajadas: numeric('horas_trabajadas', { precision: 5, scale: 2 }).notNull(),

    partidaId: uuid('partida_id')
      .notNull()
      .references(() => partidas.id),

    tarifaHoraria: numeric('tarifa_horaria', { precision: 18, scale: 4 }).notNull(),

    moneda: varchar('moneda', { length: 3 }).notNull().default('DOP'),

    costoTotal: numeric('costo_total', { precision: 18, scale: 4 }).notNull(),

    eventoId: uuid('evento_id'),

    idempotencyKey: varchar('idempotency_key', { length: 100 }).notNull(),

    ...auditColumns,
  },
  (t) => ({
    tenantIdx: index('personal_parte_tenant_idx').on(t.tenantId),
    parteIdx: index('personal_parte_parte_idx').on(t.parteId),
    partidaIdx: index('personal_parte_partida_idx').on(t.tenantId, t.partidaId),
    idempotencyUniq: uniqueIndex('personal_parte_idempotency_unique').on(t.tenantId, t.idempotencyKey),
    tipoCheck: check(
      'personal_parte_tipo_check',
      sql`${t.tipo} IN ('PROPIO','SUBCONTRATADO')`,
    ),
  }),
);

export type PersonalParteInsert = typeof personalParte.$inferInsert;
export type PersonalParteSelect = typeof personalParte.$inferSelect;
