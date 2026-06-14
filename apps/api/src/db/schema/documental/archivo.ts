import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  bigint,
  date,
  boolean,
  index,
} from 'drizzle-orm/pg-core';
import { newId } from '@tributia/shared';
import { tenants } from '../core/tenant.js';
import { auditColumns } from '../core/audit.js';
import type { CategoriaArchivo } from '@tributia/documental';

/**
 * archivo — documento vinculado polimórficamente a cualquier entidad.
 *
 * El vínculo es (entidad_tipo, entidad_id): permite adjuntar documentos a
 * proyectos, órdenes de compra, subcontratos, equipos, empleados, etc., sin
 * FK estrictas que acoplarían el módulo documental a cada dominio.
 *
 * El contenido físico reside en almacenamiento de objetos (MinIO/S3).
 * La columna storage_key apunta siempre a la versión actual; las versiones
 * anteriores se consultan en version_archivo.
 *
 * fecha_vencimiento + alerta_dias_antes controlan el job de alertas (pólizas,
 * fianzas, contratos). ultima_alerta_enviada evita envíos duplicados en el día.
 */
export const archivos = pgTable(
  'archivo',
  {
    id: uuid('id').primaryKey().$defaultFn(() => newId()),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),

    nombre: varchar('nombre', { length: 500 }).notNull(),
    descripcion: text('descripcion'),

    entidadTipo: varchar('entidad_tipo', { length: 100 }).notNull(),
    entidadId: uuid('entidad_id').notNull(),

    categoria: varchar('categoria', { length: 50 })
      .notNull()
      .default('OTRO')
      .$type<CategoriaArchivo>(),

    fechaVencimiento: date('fecha_vencimiento'),
    alertaDiasAntes: integer('alerta_dias_antes'),
    ultimaAlertaEnviada: date('ultima_alerta_enviada'),

    versionActual: integer('version_actual').notNull().default(1),

    storageKey: text('storage_key').notNull(),
    contentType: varchar('content_type', { length: 200 }).notNull(),
    tamanoBytesActual: bigint('tamano_bytes_actual', { mode: 'number' }).notNull(),

    activo: boolean('activo').notNull().default(true),

    ...auditColumns,
  },
  (t) => ({
    tenantIdx: index('archivo_tenant_idx').on(t.tenantId),
    entidadIdx: index('archivo_entidad_idx').on(t.tenantId, t.entidadTipo, t.entidadId),
    vencimientoIdx: index('archivo_vencimiento_idx').on(t.tenantId, t.fechaVencimiento),
  }),
);

export type ArchivoInsert = typeof archivos.$inferInsert;
export type ArchivoSelect = typeof archivos.$inferSelect;
