import { pgTable, uuid, varchar, numeric, index, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { newId } from '@tributia/shared';
import { tenants } from '../core/tenant.js';
import { instanciasFlujo } from '../workflow/instancia_flujo.js';
import { eventosOperativos } from '../ledger/evento_operativo.js';
import { fondosCajaChica } from './fondo_caja_chica.js';
import { auditColumns } from '../core/audit.js';

export const ESTADOS_REPOSICION_CAJA_CHICA = ['SOLICITADA', 'APROBADA', 'RECHAZADA', 'EJECUTADA'] as const;
export type EstadoReposicionCajaChica = (typeof ESTADOS_REPOSICION_CAJA_CHICA)[number];

/**
 * reposicion_caja_chica — solicitud de reposición de un fondo de caja
 * chica, gateada por el motor de workflow de Capa 0 (P9: la reposición de
 * efectivo siempre requiere aprobación).
 *
 * Máquina de estados: SOLICITADA → (workflow resuelve instancia_flujo) →
 * APROBADA|RECHAZADA → EJECUTADA (solo desde APROBADA, vía
 * ReposicionCajaChicaService.ejecutar, que es quien emite el evento
 * reposicion_caja_chica y repone fondosCajaChica.saldoDisponible).
 *
 * El servicio NUNCA confía en el estado cacheado de instancia_flujo al
 * momento de solicitar — siempre relee `WorkflowService.findInstanciaById`
 * antes de ejecutar, porque el motor de workflow no tiene callback de
 * aprobación (ver ADR si se documenta esta limitación).
 */
export const reposicionesCajaChica = pgTable(
  'reposicion_caja_chica',
  {
    id: uuid('id').primaryKey().$defaultFn(() => newId()),

    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),

    fondoId: uuid('fondo_id')
      .notNull()
      .references(() => fondosCajaChica.id),

    montoSolicitado: numeric('monto_solicitado', { precision: 18, scale: 4 }).notNull(),
    moneda: varchar('moneda', { length: 3 }).notNull().default('DOP'),

    instanciaFlujoId: uuid('instancia_flujo_id').references(() => instanciasFlujo.id),

    estado: varchar('estado', { length: 20 })
      .notNull()
      .default('SOLICITADA')
      .$type<EstadoReposicionCajaChica>(),

    eventoOrigenId: uuid('evento_origen_id').references(() => eventosOperativos.id),

    ...auditColumns,
  },
  (t) => ({
    tenantIdx: index('reposicion_caja_chica_tenant_idx').on(t.tenantId),
    fondoIdx: index('reposicion_caja_chica_fondo_idx').on(t.fondoId),
    estadoCheck: check(
      'reposicion_caja_chica_estado_check',
      sql`${t.estado} IN ('SOLICITADA','APROBADA','RECHAZADA','EJECUTADA')`,
    ),
  }),
);

export type ReposicionCajaChicaInsert = typeof reposicionesCajaChica.$inferInsert;
export type ReposicionCajaChicaSelect = typeof reposicionesCajaChica.$inferSelect;
