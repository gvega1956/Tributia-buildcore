import { timestamp, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/** Columnas de auditoría requeridas en toda tabla de negocio (P8). */
export const auditColumns = {
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .default(sql`now()`),
  createdBy: uuid('created_by').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .default(sql`now()`),
  updatedBy: uuid('updated_by').notNull(),
} as const;

/** Columnas de soft-delete opcionales. */
export const softDeleteColumns = {
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  deletedBy: uuid('deleted_by'),
} as const;
