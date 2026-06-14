import {
  pgTable,
  uuid,
  varchar,
  text,
  date,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { newId } from '@tributia/shared';
import type { TipoAsiento, EstadoAsiento } from '@tributia/contabilidad';
import { tenants } from '../core/tenant.js';
import { empresas } from '../core/tenant.js';
import { eventosOperativos } from '../ledger/evento_operativo.js';
import { reglasContables } from './regla_contable.js';
import { auditColumns } from '../core/audit.js';

/**
 * asiento_contable — asiento de partida doble generado por el motor de reglas (P4).
 *
 * Garantías de integridad:
 *   1. Tipo automático requiere evento_id (CHECK: evento_evento_obligatorio).
 *   2. Idempotencia: UNIQUE parcial sobre (evento_id, regla_id) impide doble-procesamiento.
 *   3. Asientos manuales (ajuste, apertura, cierre) NO necesitan evento_id.
 *   4. Balance (Σdebe = Σhaber) se valida en AsientoContableService antes de INSERT.
 *
 * Con RLS: cada empresa ve solo sus propios asientos.
 */
export const asientosContables = pgTable(
  'asiento_contable',
  {
    id: uuid('id').primaryKey().$defaultFn(() => newId()),

    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),

    empresaId: uuid('empresa_id')
      .notNull()
      .references(() => empresas.id),

    // Correlativo legible: "AST-2024-A1B2C3D4"
    numero: varchar('numero', { length: 30 }).notNull(),

    tipo: varchar('tipo', { length: 20 }).notNull().$type<TipoAsiento>(),

    // NULL solo para ajustes, aperturas y cierres.
    eventoId: uuid('evento_id').references(() => eventosOperativos.id),

    reglaId: uuid('regla_id').references(() => reglasContables.id),

    fecha: date('fecha').notNull(),

    descripcion: text('descripcion').notNull(),

    estado: varchar('estado', { length: 20 })
      .notNull()
      .default('borrador')
      .$type<EstadoAsiento>(),

    // Para asientos de ajuste: quién los aprobó (permiso ASIENTO_MANUAL requerido).
    aprobadoPor: uuid('aprobado_por'),

    ...auditColumns,
  },
  (t) => ({
    tenantIdx: index('asiento_tenant_id_idx').on(t.tenantId),
    eventoIdx: index('asiento_evento_id_idx').on(t.eventoId),
    fechaIdx: index('asiento_fecha_idx').on(t.fecha),

    // P4 invariant: asiento automático DEBE referenciar un evento.
    eventoObligatorioCheck: check(
      'asiento_evento_obligatorio',
      sql`${t.tipo} IN ('ajuste','apertura','cierre') OR ${t.eventoId} IS NOT NULL`,
    ),

    tipoCheck: check(
      'asiento_tipo_check',
      sql`${t.tipo} IN ('automatico','ajuste','apertura','cierre')`,
    ),

    estadoCheck: check(
      'asiento_estado_check',
      sql`${t.estado} IN ('borrador','confirmado','reversado')`,
    ),

    // Idempotencia: un evento + una regla = un solo asiento (índice parcial en migración).
    eventoReglaUniq: uniqueIndex('asiento_evento_regla_unique')
      .on(t.eventoId, t.reglaId)
      .where(sql`${t.eventoId} IS NOT NULL AND ${t.reglaId} IS NOT NULL`),
  }),
);

export type AsientoContableInsert = typeof asientosContables.$inferInsert;
export type AsientoContableSelect = typeof asientosContables.$inferSelect;
