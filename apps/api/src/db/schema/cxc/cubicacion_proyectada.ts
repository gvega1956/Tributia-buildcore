import { pgTable, uuid, varchar, numeric, date, index } from 'drizzle-orm/pg-core';
import { newId } from '@tributia/shared';
import { tenants, empresas } from '../core/tenant.js';
import { proyectos } from '../proyectos/proyecto.js';
import { cubicaciones } from './cubicacion.js';
import { auditColumns, softDeleteColumns } from '../core/audit.js';

/**
 * cubicacion_proyectada — certificación futura planificada (instrumento de planeación).
 *
 * NO pasa por el ledger: es un dato de planificación, no un hecho operativo.
 * Su contraparte real es cubicacion (CxC emitida). Cuando se emite la cubicación
 * real, se enlaza aquí con cubicacion_id para excluirla del flujo proyectado.
 *
 * Es la entrada principal del FlujoCajaService (§16): el dueño registra cuándo
 * espera certificar y cuánto, y el servicio suma cobros esperados contra pagos
 * comprometidos para responder "¿puedo sostener esta obra sin ahogarme?".
 */
export const cubicacionesProyectadas = pgTable(
  'cubicacion_proyectada',
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

    fechaProyectada: date('fecha_proyectada').notNull(),

    montoProyectado: numeric('monto_proyectado', { precision: 18, scale: 4 }).notNull(),
    moneda: varchar('moneda', { length: 3 }).notNull().default('DOP'),

    descripcion: varchar('descripcion', { length: 500 }),

    // Una vez emitida la cubicación real, se enlaza aquí → queda excluida del proyectado
    cubicacionId: uuid('cubicacion_id').references(() => cubicaciones.id),

    ...auditColumns,
    ...softDeleteColumns,
  },
  (t) => ({
    tenantIdx: index('cub_proy_tenant_idx').on(t.tenantId),
    proyectoIdx: index('cub_proy_proyecto_idx').on(t.proyectoId),
    fechaIdx: index('cub_proy_fecha_idx').on(t.fechaProyectada),
  }),
);

export type CubicacionProyectadaInsert = typeof cubicacionesProyectadas.$inferInsert;
export type CubicacionProyectadaSelect = typeof cubicacionesProyectadas.$inferSelect;
