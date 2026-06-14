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
import type { TipoIdentificacion, TipoContribuyente, CondicionDgii } from '@tributia/catalogos';
import { tenants } from '../core/tenant.js';
import { auditColumns, softDeleteColumns } from '../core/audit.js';

/**
 * tercero — entidad unificada de contrapartes (P4.2).
 *
 * Un mismo RNC puede ser cliente en un proyecto y proveedor en otro.
 * Los roles se activan con booleanos; no se duplica el registro.
 *
 * Atributos fiscales RD: rncCedula normalizado (sin guiones), tipo de
 * contribuyente y condición ante DGII. Las retenciones pueden sobreescribirse
 * por tercero; null = aplica la tasa DGII vigente.
 *
 * Con RLS: cada tenant ve solo sus terceros.
 */
export const terceros = pgTable(
  'tercero',
  {
    id: uuid('id').primaryKey().$defaultFn(() => newId()),

    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),

    tipoIdentificacion: varchar('tipo_identificacion', { length: 20 })
      .notNull()
      .$type<TipoIdentificacion>(),

    // Normalizado sin guiones: 9 dígitos (RNC) u 11 (Cédula) u texto libre (pasaporte/ext)
    rncCedula: varchar('rnc_cedula', { length: 20 }).notNull(),

    nombreComercial: varchar('nombre_comercial', { length: 200 }).notNull(),
    nombreLegal: varchar('nombre_legal', { length: 200 }),

    tipoContribuyente: varchar('tipo_contribuyente', { length: 30 })
      .notNull()
      .$type<TipoContribuyente>(),

    condicionDgii: varchar('condicion_dgii', { length: 30 })
      .notNull()
      .default('NORMAL')
      .$type<CondicionDgii>(),

    // ── Roles activables ─────────────────────────────────────────────────────
    esCliente: boolean('es_cliente').notNull().default(false),
    esProveedor: boolean('es_proveedor').notNull().default(false),
    esSubcontratista: boolean('es_subcontratista').notNull().default(false),
    esEmpleadoRelacionado: boolean('es_empleado_relacionado').notNull().default(false),
    esBanco: boolean('es_banco').notNull().default(false),
    esInstitucionEstatal: boolean('es_institucion_estatal').notNull().default(false),

    // ── Retenciones (override; NULL = usa la tasa DGII vigente) ──────────────
    retencionIsrPct: numeric('retencion_isr_pct', { precision: 5, scale: 2 }),
    retencionItbisPct: numeric('retencion_itbis_pct', { precision: 5, scale: 2 }),

    // ── Contacto ─────────────────────────────────────────────────────────────
    email: varchar('email', { length: 200 }),
    telefono: varchar('telefono', { length: 20 }),
    direccion: text('direccion'),

    activo: boolean('activo').notNull().default(true),

    ...auditColumns,
    ...softDeleteColumns,
  },
  (t) => ({
    tenantIdx: index('tercero_tenant_idx').on(t.tenantId),
    // Un tercero (por su identificación) no se duplica dentro del tenant
    tenantRncUniq: uniqueIndex('tercero_tenant_rnc_unique').on(t.tenantId, t.rncCedula),
    tipoIdCheck: check(
      'tercero_tipo_id_check',
      sql`${t.tipoIdentificacion} IN ('RNC','CEDULA','PASAPORTE','EXTRANJERO')`,
    ),
    tipoContribCheck: check(
      'tercero_tipo_contrib_check',
      sql`${t.tipoContribuyente} IN ('PERSONA_FISICA','PERSONA_JURIDICA','ENTIDAD_GUBERNAMENTAL')`,
    ),
    condicionCheck: check(
      'tercero_condicion_check',
      sql`${t.condicionDgii} IN ('NORMAL','GRAN_CONTRIBUYENTE','REGIMEN_SIMPLIFICADO')`,
    ),
    // Al menos un rol debe estar activo
    rolCheck: check(
      'tercero_rol_check',
      sql`${t.esCliente} OR ${t.esProveedor} OR ${t.esSubcontratista}
          OR ${t.esEmpleadoRelacionado} OR ${t.esBanco} OR ${t.esInstitucionEstatal}`,
    ),
  }),
);

export type TerceroInsert = typeof terceros.$inferInsert;
export type TerceroSelect = typeof terceros.$inferSelect;
