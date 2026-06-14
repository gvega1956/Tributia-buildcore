import { pgTable, uuid, varchar, boolean, integer, index, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { newId } from '@tributia/shared';
import { tenants } from '../core/tenant.js';
import { tiposFlujo } from './tipo_flujo.js';
import { auditColumns } from '../core/audit.js';

/**
 * paso_flujo — un paso de aprobación dentro de un tipo_flujo.
 *
 * Reglas de evaluación por orden:
 *   - Pasos con el mismo `orden` se procesan en PARALELO: todos deben aprobar
 *     antes de que el flujo avance al siguiente orden.
 *   - Pasos con órdenes distintos se ejecutan de forma SECUENCIAL.
 *
 * `aprobador_id` es el UUID del usuario que aprueba. (v1 = solo USUARIO;
 *  ROL y JERARQUÍA se resuelven en versiones futuras.)
 *
 * Si `vencimiento_horas` > 0 y el aprobador no responde en ese tiempo,
 * el paso queda VENCIDO. Si además `escalacion_aprobador_id` está definido,
 * se crea una nueva aprobacion_paso para ese usuario.
 */
export const pasosFlujo = pgTable(
  'paso_flujo',
  {
    id: uuid('id').primaryKey().$defaultFn(() => newId()),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    tipoFlujoId: uuid('tipo_flujo_id').notNull().references(() => tiposFlujo.id),

    orden: integer('orden').notNull(),
    nombre: varchar('nombre', { length: 200 }).notNull(),

    // v1: solo USUARIO; el valor de aprobadorId es el UUID del usuario aprobador.
    tipoAprobador: varchar('tipo_aprobador', { length: 20 }).notNull().default('USUARIO')
      .$type<'USUARIO'>(),
    aprobadorId: uuid('aprobador_id').notNull(),

    permiteDelegacion: boolean('permite_delegacion').notNull().default(true),
    vencimientoHoras: integer('vencimiento_horas'),
    escalacionAprobadorId: uuid('escalacion_aprobador_id'),

    activo: boolean('activo').notNull().default(true),

    ...auditColumns,
  },
  (t) => ({
    tipoFlujoIdx: index('paso_flujo_tipo_flujo_idx').on(t.tipoFlujoId),
    tenantIdx: index('paso_flujo_tenant_idx').on(t.tenantId),
    tipoAprobCheck: check(
      'paso_flujo_tipo_aprobador_check',
      sql`${t.tipoAprobador} IN ('USUARIO')`,
    ),
  }),
);

export type PasoFlujoInsert = typeof pasosFlujo.$inferInsert;
export type PasoFlujoSelect = typeof pasosFlujo.$inferSelect;
