import { pgTable, uuid, varchar, numeric, date, timestamp, index } from 'drizzle-orm/pg-core';
import { newId } from '@tributia/shared';
import { tenants, empresas } from '../core/tenant.js';
import { cuentasBancarias } from './cuenta_bancaria.js';
import { movimientosBancarios } from './movimiento_bancario.js';
import { auditColumns } from '../core/audit.js';

/**
 * extracto_bancario — lote de importación de un estado de cuenta
 * (Excel/CSV) para una cuenta bancaria y un período. Header de
 * linea_extracto (§16, conciliación bancaria).
 */
export const extractosBancarios = pgTable(
  'extracto_bancario',
  {
    id: uuid('id').primaryKey().$defaultFn(() => newId()),

    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),

    empresaId: uuid('empresa_id')
      .notNull()
      .references(() => empresas.id),

    cuentaBancariaId: uuid('cuenta_bancaria_id')
      .notNull()
      .references(() => cuentasBancarias.id),

    periodoDesde: date('periodo_desde').notNull(),
    periodoHasta: date('periodo_hasta').notNull(),
    archivoNombre: varchar('archivo_nombre', { length: 255 }).notNull(),
    fechaImportacion: timestamp('fecha_importacion', { withTimezone: true }).notNull(),

    ...auditColumns,
  },
  (t) => ({
    tenantIdx: index('extracto_tenant_idx').on(t.tenantId),
    cuentaIdx: index('extracto_cuenta_idx').on(t.cuentaBancariaId),
  }),
);

export type ExtractoBancarioInsert = typeof extractosBancarios.$inferInsert;
export type ExtractoBancarioSelect = typeof extractosBancarios.$inferSelect;

export const ESTADOS_LINEA_EXTRACTO = ['PENDIENTE', 'CONCILIADA', 'DIFERENCIA', 'IGNORADA'] as const;
export type EstadoLineaExtracto = (typeof ESTADOS_LINEA_EXTRACTO)[number];

/**
 * linea_extracto — una fila del estado de cuenta importado.
 *
 * `monto` es firmado: positivo = depósito, negativo = retiro (igual que la
 * mayoría de exports bancarios reales). El matching automático
 * (ConciliacionBancariaService) busca un movimiento_bancario sin conciliar
 * en la misma cuenta con fecha cercana y mismo monto absoluto; si lo
 * encuentra marca ambos como CONCILIADA, si no, queda en DIFERENCIA para
 * resolución manual.
 */
export const lineasExtracto = pgTable(
  'linea_extracto',
  {
    id: uuid('id').primaryKey().$defaultFn(() => newId()),

    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),

    extractoBancarioId: uuid('extracto_bancario_id')
      .notNull()
      .references(() => extractosBancarios.id),

    fecha: date('fecha').notNull(),
    descripcion: varchar('descripcion', { length: 500 }).notNull(),
    monto: numeric('monto', { precision: 18, scale: 4 }).notNull(),
    referencia: varchar('referencia', { length: 100 }),

    estado: varchar('estado', { length: 20 })
      .notNull()
      .default('PENDIENTE')
      .$type<EstadoLineaExtracto>(),

    movimientoBancarioId: uuid('movimiento_bancario_id').references(() => movimientosBancarios.id),

    ...auditColumns,
  },
  (t) => ({
    tenantIdx: index('linea_extracto_tenant_idx').on(t.tenantId),
    extractoIdx: index('linea_extracto_extracto_idx').on(t.extractoBancarioId),
    estadoIdx: index('linea_extracto_estado_idx').on(t.estado),
  }),
);

export type LineaExtractoInsert = typeof lineasExtracto.$inferInsert;
export type LineaExtractoSelect = typeof lineasExtracto.$inferSelect;
