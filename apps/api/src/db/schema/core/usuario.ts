import {
  pgTable,
  uuid,
  varchar,
  boolean,
  text,
  index,
  unique,
} from 'drizzle-orm/pg-core';
import { newId } from '@tributia/shared';
import { auditColumns } from './audit.js';
import { tenants } from './tenant.js';

/**
 * usuario — cuenta de acceso dentro de un tenant.
 * email es único por tenant (mismo email puede existir en distintos tenants).
 * Tiene tenant_id + RLS.
 */
export const usuarios = pgTable(
  'usuario',
  {
    id: uuid('id').primaryKey().$defaultFn(() => newId()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    email: varchar('email', { length: 254 }).notNull(),
    passwordHash: text('password_hash').notNull(),
    nombre: varchar('nombre', { length: 100 }).notNull(),
    apellido: varchar('apellido', { length: 100 }).notNull(),
    activo: boolean('activo').notNull().default(true),
    ...auditColumns,
  },
  (t) => ({
    tenantIdx: index('usuario_tenant_id_idx').on(t.tenantId),
    emailTenantUnique: unique('usuario_email_tenant_unique').on(t.email, t.tenantId),
  }),
);

export type UsuarioInsert = typeof usuarios.$inferInsert;
export type UsuarioSelect = typeof usuarios.$inferSelect;
