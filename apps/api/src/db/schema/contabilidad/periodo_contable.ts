import {
  pgTable, uuid, smallint, varchar, text, timestamp, index, uniqueIndex, check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { newId } from '@tributia/shared';
import { tenants, empresas } from '../core/tenant.js';
import { auditColumns } from '../core/audit.js';

export type EstadoPeriodo = 'ABIERTO' | 'CERRADO' | 'REABIERTO';

export const periodosContables = pgTable('periodo_contable', {
  id:         uuid('id').primaryKey().$defaultFn(() => newId()),
  tenantId:   uuid('tenant_id').notNull().references(() => tenants.id),
  empresaId:  uuid('empresa_id').notNull().references(() => empresas.id),
  anio:       smallint('anio').notNull(),
  mes:        smallint('mes').notNull(),
  estado:     varchar('estado', { length: 20 }).notNull().default('ABIERTO').$type<EstadoPeriodo>(),
  fechaCierre:      timestamp('fecha_cierre', { withTimezone: true }),
  cerradoPor:       uuid('cerrado_por'),
  fechaReapertura:  timestamp('fecha_reapertura', { withTimezone: true }),
  reabiertoPor:     uuid('reabierto_por'),
  motivoReapertura: text('motivo_reapertura'),
  ...auditColumns,
}, (t) => ({
  tenantIdx:          index('periodo_tenant_id_idx').on(t.tenantId),
  empresaAnioMesUniq: uniqueIndex('periodo_empresa_anio_mes_unique').on(t.empresaId, t.anio, t.mes),
  estadoCheck:        check('periodo_estado_check', sql`${t.estado} IN ('ABIERTO','CERRADO','REABIERTO')`),
  mesCheck:           check('periodo_mes_check', sql`${t.mes} BETWEEN 1 AND 12`),
}));

export type PeriodoContableInsert = typeof periodosContables.$inferInsert;
export type PeriodoContableSelect = typeof periodosContables.$inferSelect;
