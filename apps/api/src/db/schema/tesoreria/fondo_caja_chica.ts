import { pgTable, uuid, varchar, numeric, boolean, index, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { newId } from '@tributia/shared';
import { tenants, empresas } from '../core/tenant.js';
import { proyectos } from '../proyectos/proyecto.js';
import { usuarios } from '../core/usuario.js';
import { cuentasBancarias } from './cuenta_bancaria.js';
import { auditColumns } from '../core/audit.js';

export const ESTADOS_FONDO_CAJA_CHICA = ['ACTIVO', 'CERRADO'] as const;
export type EstadoFondoCajaChica = (typeof ESTADOS_FONDO_CAJA_CHICA)[number];

/**
 * fondo_caja_chica — fondo de caja chica asignado a una obra (§16: "dolor
 * universal de la construcción"). `saldoDisponible` baja con cada
 * gasto_caja_chica y sube cuando una reposicion_caja_chica se ejecuta.
 *
 * `cuentaBancariaOrigenId` es la cuenta bancaria desde donde se repone el
 * fondo — necesaria para que ReposicionCajaChicaService sepa de dónde
 * sale el dinero.
 */
export const fondosCajaChica = pgTable(
  'fondo_caja_chica',
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

    responsableId: uuid('responsable_id')
      .notNull()
      .references(() => usuarios.id),

    cuentaBancariaOrigenId: uuid('cuenta_bancaria_origen_id')
      .notNull()
      .references(() => cuentasBancarias.id),

    montoAsignado: numeric('monto_asignado', { precision: 18, scale: 4 }).notNull(),
    saldoDisponible: numeric('saldo_disponible', { precision: 18, scale: 4 }).notNull(),
    moneda: varchar('moneda', { length: 3 }).notNull().default('DOP'),

    estado: varchar('estado', { length: 20 })
      .notNull()
      .default('ACTIVO')
      .$type<EstadoFondoCajaChica>(),

    activo: boolean('activo').notNull().default(true),

    ...auditColumns,
  },
  (t) => ({
    tenantIdx: index('fondo_caja_chica_tenant_idx').on(t.tenantId),
    proyectoIdx: index('fondo_caja_chica_proyecto_idx').on(t.proyectoId),
    estadoCheck: check('fondo_caja_chica_estado_check', sql`${t.estado} IN ('ACTIVO','CERRADO')`),
  }),
);

export type FondoCajaChicaInsert = typeof fondosCajaChica.$inferInsert;
export type FondoCajaChicaSelect = typeof fondosCajaChica.$inferSelect;
