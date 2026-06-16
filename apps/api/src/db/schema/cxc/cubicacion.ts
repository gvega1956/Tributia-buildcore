import {
  pgTable,
  uuid,
  varchar,
  integer,
  numeric,
  date,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { newId } from '@tributia/shared';
import { tenants, empresas } from '../core/tenant.js';
import { proyectos } from '../proyectos/proyecto.js';
import { partidas } from '../proyectos/partida.js';
import { auditColumns, softDeleteColumns } from '../core/audit.js';

export const ESTADOS_CUBICACION = ['EMITIDA', 'ANULADA'] as const;
export type EstadoCubicacion = (typeof ESTADOS_CUBICACION)[number];

/**
 * cubicacion — certificación de avance físico facturable por período (§16).
 *
 * Nace de `ejecucion_partida.avance_cantidad` (avance "aprobado" — ver ADR-0006),
 * nunca de una cifra escrita a mano. Es el puente entre obra y CxC:
 * convierte cantidad ejecutada en monto facturable, con su retención de
 * garantía si el contrato la define (`proyecto.retencion_garantia_pct`).
 */
export const cubicaciones = pgTable(
  'cubicacion',
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

    numero: integer('numero').notNull(),

    fechaCorte: date('fecha_corte').notNull(),

    // Snapshot del % vigente en proyecto al momento de emitir (el contrato puede cambiar después)
    retencionGarantiaPct: numeric('retencion_garantia_pct', { precision: 5, scale: 2 }),

    montoBruto: numeric('monto_bruto', { precision: 18, scale: 4 }).notNull(),
    montoRetencionGarantia: numeric('monto_retencion_garantia', { precision: 18, scale: 4 })
      .notNull()
      .default('0.0000'),
    montoFacturable: numeric('monto_facturable', { precision: 18, scale: 4 }).notNull(),
    moneda: varchar('moneda', { length: 3 }).notNull().default('DOP'),

    estado: varchar('estado', { length: 20 })
      .notNull()
      .default('EMITIDA')
      .$type<EstadoCubicacion>(),

    // Se enlaza una vez que FacturaClienteService emite la factura sobre esta cubicación
    facturaClienteId: uuid('factura_cliente_id'),

    ...auditColumns,
    ...softDeleteColumns,
  },
  (t) => ({
    tenantIdx: index('cubicacion_tenant_id_idx').on(t.tenantId),
    proyectoIdx: index('cubicacion_proyecto_id_idx').on(t.proyectoId),
    numeroUniq: uniqueIndex('cubicacion_tenant_proyecto_numero_unique').on(
      t.tenantId,
      t.proyectoId,
      t.numero,
    ),
    estadoCheck: check('cubicacion_estado_check', sql`${t.estado} IN ('EMITIDA','ANULADA')`),
  }),
);

export const cubicacionLineas = pgTable(
  'cubicacion_linea',
  {
    id: uuid('id').primaryKey().$defaultFn(() => newId()),

    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),

    cubicacionId: uuid('cubicacion_id')
      .notNull()
      .references(() => cubicaciones.id),

    partidaId: uuid('partida_id')
      .notNull()
      .references(() => partidas.id),

    // Cantidad ya certificada en cubicaciones anteriores de esta partida (antes de este período)
    cantidadAnterior: numeric('cantidad_anterior', { precision: 18, scale: 4 })
      .notNull()
      .default('0.0000'),

    // Cantidad certificada en este período
    cantidadPeriodo: numeric('cantidad_periodo', { precision: 18, scale: 4 }).notNull(),

    // anterior + periodo — nunca puede superar ejecucion_partida.avance_cantidad (ADR-0006)
    cantidadAcumulada: numeric('cantidad_acumulada', { precision: 18, scale: 4 }).notNull(),

    precioUnitario: numeric('precio_unitario', { precision: 18, scale: 4 }).notNull(),
    monto: numeric('monto', { precision: 18, scale: 4 }).notNull(),
    moneda: varchar('moneda', { length: 3 }).notNull().default('DOP'),

    ...auditColumns,
  },
  (t) => ({
    tenantIdx: index('cubicacion_linea_tenant_idx').on(t.tenantId),
    cubicacionIdx: index('cubicacion_linea_cubicacion_idx').on(t.cubicacionId),
    partidaIdx: index('cubicacion_linea_partida_idx').on(t.partidaId),
    partidaUniq: uniqueIndex('cubicacion_linea_cubicacion_partida_unique').on(
      t.cubicacionId,
      t.partidaId,
    ),
  }),
);

export type CubicacionInsert = typeof cubicaciones.$inferInsert;
export type CubicacionSelect = typeof cubicaciones.$inferSelect;
export type CubicacionLineaInsert = typeof cubicacionLineas.$inferInsert;
export type CubicacionLineaSelect = typeof cubicacionLineas.$inferSelect;
