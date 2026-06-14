import {
  pgTable,
  uuid,
  varchar,
  boolean,
  numeric,
  text,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { newId } from '@tributia/shared';
import type { CategoriaEquipo } from '@tributia/catalogos';
import { tenants } from '../core/tenant.js';
import { auditColumns, softDeleteColumns } from '../core/audit.js';

/**
 * equipo_catalogo — tipos de equipos y maquinaria con tarifa horaria interna.
 *
 * La tarifa_horaria representa el costo interno por hora (depreciación +
 * mantenimiento + combustible + seguro + operador). Cuando el parte diario
 * registra horas de este tipo de equipo, ese costo se imputa automáticamente
 * a la partida del proyecto.
 *
 * Con RLS: cada tenant define sus tipos de equipo y tarifas.
 */
export const equiposCatalogo = pgTable(
  'equipo_catalogo',
  {
    id: uuid('id').primaryKey().$defaultFn(() => newId()),

    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),

    codigo: varchar('codigo', { length: 50 }).notNull(),
    nombre: varchar('nombre', { length: 200 }).notNull(),
    descripcion: text('descripcion'),

    categoria: varchar('categoria', { length: 30 })
      .notNull()
      .default('OTRO')
      .$type<CategoriaEquipo>(),

    // Tarifa horaria interna en la moneda indicada — NUMERIC(18,4).
    tarifaHoraria: numeric('tarifa_horaria', { precision: 18, scale: 4 }).notNull(),
    monedaTarifa: varchar('moneda_tarifa', { length: 3 }).notNull().default('DOP'),

    activo: boolean('activo').notNull().default(true),

    ...auditColumns,
    ...softDeleteColumns,
  },
  (t) => ({
    tenantIdx: index('equipo_cat_tenant_idx').on(t.tenantId),
    tenantCodigoUniq: uniqueIndex('equipo_cat_tenant_codigo_unique').on(t.tenantId, t.codigo),
    categoriaCheck: check(
      'equipo_cat_categoria_check',
      sql`${t.categoria} IN ('MAQUINARIA_PESADA','VEHICULO_LIVIANO','VEHICULO_PESADO','HERRAMIENTA_MAYOR','PLANTA_ELECTRICA','BOMBA','OTRO')`,
    ),
  }),
);

export type EquipoCatalogoInsert = typeof equiposCatalogo.$inferInsert;
export type EquipoCatalogoSelect = typeof equiposCatalogo.$inferSelect;
