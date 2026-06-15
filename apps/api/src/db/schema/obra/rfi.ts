import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  numeric,
  date,
  timestamp,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { newId } from '@tributia/shared';
import { tenants } from '../core/tenant.js';
import { proyectos } from '../proyectos/proyecto.js';
import { auditColumns, softDeleteColumns } from '../core/audit.js';

export const ESTADOS_RFI = ['ABIERTO', 'RESPONDIDO', 'CERRADO'] as const;
export type EstadoRfi = (typeof ESTADOS_RFI)[number];

export const IMPACTOS_RFI = ['NINGUNO', 'DIAS', 'COSTO', 'AMBOS'] as const;
export type ImpactoRfi = (typeof IMPACTOS_RFI)[number];

/**
 * rfi — Request for Information (solicitud de información/aclaración).
 *
 * Flujo: ABIERTO → RESPONDIDO → CERRADO.
 * numero es secuencial por proyecto (no global por tenant).
 * impacto registra si el RFI bloquea ruta crítica o afecta costo.
 */
export const rfis = pgTable(
  'rfi',
  {
    id: uuid('id').primaryKey().$defaultFn(() => newId()),

    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),

    proyectoId: uuid('proyecto_id')
      .notNull()
      .references(() => proyectos.id),

    numero: integer('numero').notNull(),

    titulo: varchar('titulo', { length: 500 }).notNull(),

    descripcion: text('descripcion').notNull(),

    impacto: varchar('impacto', { length: 20 })
      .notNull()
      .default('NINGUNO')
      .$type<ImpactoRfi>(),

    impactoDias: integer('impacto_dias'),

    impactoMonto: numeric('impacto_monto', { precision: 18, scale: 4 }),

    estado: varchar('estado', { length: 20 })
      .notNull()
      .default('ABIERTO')
      .$type<EstadoRfi>(),

    asignadoA: uuid('asignado_a'),

    fechaLimite: date('fecha_limite'),

    respuesta: text('respuesta'),

    fechaRespuesta: date('fecha_respuesta'),

    respondidoPor: uuid('respondido_por'),

    cerradoEn: timestamp('cerrado_en', { withTimezone: true }),

    cerradoPor: uuid('cerrado_por'),

    ...auditColumns,
    ...softDeleteColumns,
  },
  (t) => ({
    tenantIdx: index('rfi_tenant_idx').on(t.tenantId),
    proyectoIdx: index('rfi_proyecto_idx').on(t.proyectoId),
    numeroUniq: uniqueIndex('rfi_tenant_proyecto_numero_unique').on(t.tenantId, t.proyectoId, t.numero),
    estadoCheck: check(
      'rfi_estado_check',
      sql`${t.estado} IN ('ABIERTO','RESPONDIDO','CERRADO')`,
    ),
    impactoCheck: check(
      'rfi_impacto_check',
      sql`${t.impacto} IN ('NINGUNO','DIAS','COSTO','AMBOS')`,
    ),
  }),
);

export type RfiInsert = typeof rfis.$inferInsert;
export type RfiSelect = typeof rfis.$inferSelect;
