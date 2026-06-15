import {
  pgTable,
  uuid,
  varchar,
  text,
  date,
  timestamp,
  index,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { newId } from '@tributia/shared';
import { tenants } from '../core/tenant.js';
import { proyectos } from '../proyectos/proyecto.js';
import { auditColumns } from '../core/audit.js';

export const ESTADOS_PUNCH = ['PENDIENTE', 'EN_PROGRESO', 'COMPLETADO', 'RECHAZADO'] as const;
export type EstadoPunch = (typeof ESTADOS_PUNCH)[number];

/**
 * punch_list_item — defecto o pendiente de cierre en obra.
 *
 * Flujo: PENDIENTE → EN_PROGRESO → COMPLETADO | RECHAZADO.
 * responsable_id es el usuario que debe resolver el ítem.
 * evidencia_archivo_id es la foto o documento que cierra el ítem.
 */
export const punchListItems = pgTable(
  'punch_list_item',
  {
    id: uuid('id').primaryKey().$defaultFn(() => newId()),

    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),

    proyectoId: uuid('proyecto_id')
      .notNull()
      .references(() => proyectos.id),

    descripcion: text('descripcion').notNull(),

    ubicacion: varchar('ubicacion', { length: 500 }),

    responsableId: uuid('responsable_id'),

    fechaLimite: date('fecha_limite'),

    estado: varchar('estado', { length: 20 })
      .notNull()
      .default('PENDIENTE')
      .$type<EstadoPunch>(),

    evidenciaArchivoId: uuid('evidencia_archivo_id'),

    resueltoEn: timestamp('resuelto_en', { withTimezone: true }),

    resueltoPor: uuid('resuelto_por'),

    ...auditColumns,
  },
  (t) => ({
    tenantIdx: index('punch_list_tenant_idx').on(t.tenantId),
    proyectoIdx: index('punch_list_proyecto_idx').on(t.proyectoId),
    estadoIdx: index('punch_list_estado_idx').on(t.proyectoId, t.estado),
    estadoCheck: check(
      'punch_list_estado_check',
      sql`${t.estado} IN ('PENDIENTE','EN_PROGRESO','COMPLETADO','RECHAZADO')`,
    ),
  }),
);

export type PunchListItemInsert = typeof punchListItems.$inferInsert;
export type PunchListItemSelect = typeof punchListItems.$inferSelect;
