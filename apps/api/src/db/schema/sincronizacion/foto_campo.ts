import {
  pgTable,
  uuid,
  varchar,
  numeric,
  integer,
  timestamp,
  uniqueIndex,
  index,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { newId } from '@tributia/shared';
import { tenants, empresas } from '../core/tenant.js';
import { auditColumns } from '../core/audit.js';

export const ESTADOS_FOTO_CAMPO = ['PENDIENTE_SUBIDA', 'SUBIDA', 'ERROR_SUBIDA'] as const;
export type EstadoFotoCampo = (typeof ESTADOS_FOTO_CAMPO)[number];

/**
 * foto_campo — fotos georreferenciadas con subida diferida (P7).
 *
 * El dispositivo captura la foto offline junto con coordenadas GPS.
 * Al recuperar señal, sube el binario a S3/MinIO y confirma la subida
 * actualizando storage_key + estado = 'SUBIDA'.
 *
 * Deduplicación por (tenant_id, entidad_id, hash_local): el mismo archivo
 * para la misma entidad nunca se registra dos veces.
 *
 * Una vez SUBIDA, puede vincularse como foto_parte o version_archivo
 * en el módulo documental.
 */
export const fotosCampo = pgTable(
  'foto_campo',
  {
    id: uuid('id').primaryKey().$defaultFn(() => newId()),

    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),

    empresaId: uuid('empresa_id')
      .notNull()
      .references(() => empresas.id),

    entidadTipo: varchar('entidad_tipo', { length: 50 }).notNull(),

    entidadId: uuid('entidad_id').notNull(),

    storageKey: varchar('storage_key', { length: 500 }),

    estado: varchar('estado', { length: 30 })
      .notNull()
      .default('PENDIENTE_SUBIDA')
      .$type<EstadoFotoCampo>(),

    latitud: numeric('latitud', { precision: 10, scale: 7 }),

    longitud: numeric('longitud', { precision: 10, scale: 7 }),

    precisionMetros: numeric('precision_metros', { precision: 8, scale: 2 }),

    timestampCaptura: timestamp('timestamp_captura', { withTimezone: true }).notNull(),

    hashLocal: varchar('hash_local', { length: 100 }).notNull(),

    bytes: integer('bytes'),

    mimeType: varchar('mime_type', { length: 50 }),

    ...auditColumns,
  },
  (t) => ({
    hashEntidadUniq: uniqueIndex('foto_campo_hash_entidad_uniq').on(
      t.tenantId,
      t.entidadId,
      t.hashLocal,
    ),
    entidadIdx: index('foto_campo_entidad_idx').on(t.tenantId, t.entidadTipo, t.entidadId),
    estadoIdx: index('foto_campo_estado_idx').on(t.estado),
    estadoCheck: check(
      'foto_campo_estado_check',
      sql`${t.estado} IN ('PENDIENTE_SUBIDA','SUBIDA','ERROR_SUBIDA')`,
    ),
  }),
);

export type FotoCampoInsert = typeof fotosCampo.$inferInsert;
export type FotoCampoSelect = typeof fotosCampo.$inferSelect;
