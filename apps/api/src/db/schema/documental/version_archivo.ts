import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  bigint,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { newId } from '@tributia/shared';
import { tenants } from '../core/tenant.js';
import { archivos } from './archivo.js';
import { auditColumns } from '../core/audit.js';

/**
 * version_archivo — registro inmutable de cada versión de un archivo.
 *
 * Append-only: cada nueva subida añade una fila con numero_version + 1.
 * La versión activa se refleja en archivo.version_actual y archivo.storage_key.
 * Las versiones anteriores siguen accesibles por su storage_key propio.
 *
 * checksum_sha256 permite verificar integridad sin descargar el objeto.
 */
export const versionesArchivo = pgTable(
  'version_archivo',
  {
    id: uuid('id').primaryKey().$defaultFn(() => newId()),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    archivoId: uuid('archivo_id').notNull().references(() => archivos.id),

    numeroVersion: integer('numero_version').notNull(),
    storageKey: text('storage_key').notNull(),
    contentType: varchar('content_type', { length: 200 }).notNull(),
    tamanoBytes: bigint('tamano_bytes', { mode: 'number' }).notNull(),

    checksumSha256: varchar('checksum_sha256', { length: 64 }),
    nota: text('nota'),

    ...auditColumns,
  },
  (t) => ({
    archivoIdx: index('version_archivo_archivo_idx').on(t.archivoId),
    tenantIdx: index('version_archivo_tenant_idx').on(t.tenantId),
    versionUniqueIdx: uniqueIndex('version_archivo_unique_version_idx').on(
      t.archivoId,
      t.numeroVersion,
    ),
  }),
);

export type VersionArchivoInsert = typeof versionesArchivo.$inferInsert;
export type VersionArchivoSelect = typeof versionesArchivo.$inferSelect;
