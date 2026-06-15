import {
  pgTable,
  uuid,
  varchar,
  numeric,
  text,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { newId } from '@tributia/shared';
import { tenants } from '../core/tenant.js';
import { partesDiario } from './parte_diario.js';
import { partidas } from '../proyectos/partida.js';
import { equiposCatalogo } from '../catalogos/equipo_catalogo.js';
import { auditColumns } from '../core/audit.js';

/**
 * equipo_parte — equipos y maquinaria operando en el parte diario, por partida.
 *
 * Al confirmar el parte se emite evento hora_equipo por fila. El handler
 * aplica costoTotal = horasOperadas * tarifaHoraria a ejecucion_partida.devengado
 * y genera el asiento contable si la regla existe.
 *
 * tarifaHoraria se fija al momento del parte (snapshot del catálogo); no cambia
 * si la tarifa del equipo se actualiza después.
 */
export const equipoParte = pgTable(
  'equipo_parte',
  {
    id: uuid('id').primaryKey().$defaultFn(() => newId()),

    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),

    parteId: uuid('parte_id')
      .notNull()
      .references(() => partesDiario.id),

    equipoId: uuid('equipo_id')
      .notNull()
      .references(() => equiposCatalogo.id),

    horasOperadas: numeric('horas_operadas', { precision: 5, scale: 2 }).notNull(),

    partidaId: uuid('partida_id')
      .notNull()
      .references(() => partidas.id),

    tarifaHoraria: numeric('tarifa_horaria', { precision: 18, scale: 4 }).notNull(),

    moneda: varchar('moneda', { length: 3 }).notNull().default('DOP'),

    costoTotal: numeric('costo_total', { precision: 18, scale: 4 }).notNull(),

    observaciones: text('observaciones'),

    eventoId: uuid('evento_id'),

    idempotencyKey: varchar('idempotency_key', { length: 100 }).notNull(),

    ...auditColumns,
  },
  (t) => ({
    tenantIdx: index('equipo_parte_tenant_idx').on(t.tenantId),
    parteIdx: index('equipo_parte_parte_idx').on(t.parteId),
    equipoIdx: index('equipo_parte_equipo_idx').on(t.equipoId),
    idempotencyUniq: uniqueIndex('equipo_parte_idempotency_unique').on(t.tenantId, t.idempotencyKey),
  }),
);

export type EquipoParteInsert = typeof equipoParte.$inferInsert;
export type EquipoParteSelect = typeof equipoParte.$inferSelect;
