import {
  pgTable,
  uuid,
  varchar,
  text,
  numeric,
  boolean,
  date,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { newId } from '@tributia/shared';
import { tenants, empresas } from '../core/tenant.js';
import { terceros } from '../catalogos/tercero.js';
import { auditColumns, softDeleteColumns } from '../core/audit.js';

export const ESTADOS_PROYECTO = [
  'PROSPECTO',
  'LICITACION',
  'ADJUDICADO',
  'EN_EJECUCION',
  'CIERRE',
  'GARANTIA',
  'CERRADO',
] as const;
export type EstadoProyecto = (typeof ESTADOS_PROYECTO)[number];

export const TIPOS_OBRA = [
  'RESIDENCIAL',
  'COMERCIAL',
  'INDUSTRIAL',
  'VIAL',
  'HIDRAULICO',
  'INSTITUCIONAL',
  'MIXTO',
  'OTRO',
] as const;
export type TipoObra = (typeof TIPOS_OBRA)[number];

/**
 * proyecto — la entidad reina (§4.3 arquitectura.md / P3).
 *
 * Nace en el CRM como PROSPECTO y muere en contabilidad como CERRADO.
 * Es siempre el mismo registro; nunca se exporta entre módulos.
 *
 * cliente_id referencia Tercero con es_cliente=true (nunca texto libre).
 * Con RLS: cada tenant ve solo sus proyectos.
 */
export const proyectos = pgTable(
  'proyecto',
  {
    id: uuid('id').primaryKey().$defaultFn(() => newId()),

    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),

    empresaId: uuid('empresa_id')
      .notNull()
      .references(() => empresas.id),

    codigo: varchar('codigo', { length: 50 }).notNull(),
    nombre: varchar('nombre', { length: 200 }).notNull(),
    descripcion: text('descripcion'),

    estado: varchar('estado', { length: 30 })
      .notNull()
      .default('PROSPECTO')
      .$type<EstadoProyecto>(),

    tipoObra: varchar('tipo_obra', { length: 30 })
      .notNull()
      .$type<TipoObra>(),

    clienteId: uuid('cliente_id')
      .notNull()
      .references(() => terceros.id),

    numeroContrato: varchar('numero_contrato', { length: 100 }),

    // NUMERIC(18,4) per reglas de datos — nunca float para dinero
    montoContrato: numeric('monto_contrato', { precision: 18, scale: 4 }),
    monedaContrato: varchar('moneda_contrato', { length: 3 }).notNull().default('DOP'),

    fechaInicioPlanificada: date('fecha_inicio_planificada'),
    fechaFinPlanificada: date('fecha_fin_planificada'),
    fechaInicioReal: date('fecha_inicio_real'),
    fechaFinReal: date('fecha_fin_real'),

    ubicacionDescripcion: text('ubicacion_descripcion'),
    latitud: numeric('latitud', { precision: 10, scale: 7 }),
    longitud: numeric('longitud', { precision: 10, scale: 7 }),

    activo: boolean('activo').notNull().default(true),

    // Suma acumulada de montos aprobados de Órdenes de Cambio (§9).
    // presupuesto vigente total = monto_contrato + presupuesto_vigente_monto
    presupuestoVigenteMonto: numeric('presupuesto_vigente_monto', { precision: 18, scale: 4 })
      .notNull()
      .default('0.0000'),

    ...auditColumns,
    ...softDeleteColumns,
  },
  (t) => ({
    tenantIdx: index('proyecto_tenant_id_idx').on(t.tenantId),
    empresaIdx: index('proyecto_empresa_id_idx').on(t.empresaId),
    tenantEmpresaCodigoUniq: uniqueIndex('proyecto_tenant_empresa_codigo_unique').on(
      t.tenantId,
      t.empresaId,
      t.codigo,
    ),
    estadoCheck: check(
      'proyecto_estado_check',
      sql`${t.estado} IN ('PROSPECTO','LICITACION','ADJUDICADO','EN_EJECUCION','CIERRE','GARANTIA','CERRADO')`,
    ),
    tipoObraCheck: check(
      'proyecto_tipo_obra_check',
      sql`${t.tipoObra} IN ('RESIDENCIAL','COMERCIAL','INDUSTRIAL','VIAL','HIDRAULICO','INSTITUCIONAL','MIXTO','OTRO')`,
    ),
  }),
);

export type ProyectoInsert = typeof proyectos.$inferInsert;
export type ProyectoSelect = typeof proyectos.$inferSelect;
