import {
  pgTable,
  uuid,
  varchar,
  boolean,
  text,
  index,
  unique,
  primaryKey,
  timestamp,
} from 'drizzle-orm/pg-core';
import { newId } from '@tributia/shared';
import { auditColumns } from './audit.js';
import { tenants } from './tenant.js';
import { empresas } from './tenant.js';
import { usuarios } from './usuario.js';

/**
 * rol — perfil de permisos dentro de un tenant.
 * esSistema = true en los roles plantilla precargados; no pueden ser eliminados.
 * Tiene tenant_id + RLS.
 */
export const roles = pgTable(
  'rol',
  {
    id: uuid('id').primaryKey().$defaultFn(() => newId()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    nombre: varchar('nombre', { length: 100 }).notNull(),
    descripcion: text('descripcion'),
    esSistema: boolean('es_sistema').notNull().default(false),
    activo: boolean('activo').notNull().default(true),
    ...auditColumns,
  },
  (t) => ({
    tenantIdx: index('rol_tenant_id_idx').on(t.tenantId),
    nombreTenantUnique: unique('rol_nombre_tenant_unique').on(t.nombre, t.tenantId),
  }),
);

/**
 * rol_permiso — catálogo de permisos asignados a un rol.
 * `permiso` referencia los códigos del catálogo cerrado en PERMISSIONS.
 * PK compuesta (rol_id, permiso) evita duplicados.
 * Tiene tenant_id + RLS.
 */
export const rolPermisos = pgTable(
  'rol_permiso',
  {
    rolId: uuid('rol_id')
      .notNull()
      .references(() => roles.id),
    permiso: varchar('permiso', { length: 100 }).notNull(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    ...auditColumns,
  },
  (t) => ({
    pk: primaryKey({ columns: [t.rolId, t.permiso] }),
    tenantIdx: index('rol_permiso_tenant_id_idx').on(t.tenantId),
  }),
);

/**
 * usuario_rol_empresa — asignación de rol a usuario dentro de una empresa.
 * Un usuario tiene exactamente un rol por empresa.
 * Tiene tenant_id + RLS.
 */
export const usuarioRolEmpresa = pgTable(
  'usuario_rol_empresa',
  {
    id: uuid('id').primaryKey().$defaultFn(() => newId()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    usuarioId: uuid('usuario_id')
      .notNull()
      .references(() => usuarios.id),
    empresaId: uuid('empresa_id')
      .notNull()
      .references(() => empresas.id),
    rolId: uuid('rol_id')
      .notNull()
      .references(() => roles.id),
    ...auditColumns,
  },
  (t) => ({
    tenantIdx: index('ure_tenant_id_idx').on(t.tenantId),
    usuarioEmpresaUnique: unique('ure_usuario_empresa_unique').on(t.usuarioId, t.empresaId),
  }),
);

/**
 * usuario_rol_proyecto — rol opcional a nivel de proyecto (override del empresa-level).
 * proyecto_id es UUID sin FK por ahora; la FK se añadirá cuando se cree la tabla `proyecto`.
 * Tiene tenant_id + RLS.
 */
export const usuarioRolProyecto = pgTable(
  'usuario_rol_proyecto',
  {
    id: uuid('id').primaryKey().$defaultFn(() => newId()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    usuarioId: uuid('usuario_id')
      .notNull()
      .references(() => usuarios.id),
    // FK a proyecto.id se añade en la migración de Session 5
    proyectoId: uuid('proyecto_id').notNull(),
    rolId: uuid('rol_id')
      .notNull()
      .references(() => roles.id),
    ...auditColumns,
  },
  (t) => ({
    tenantIdx: index('urp_tenant_id_idx').on(t.tenantId),
    usuarioProyectoUnique: unique('urp_usuario_proyecto_unique').on(t.usuarioId, t.proyectoId),
  }),
);

/**
 * refresh_token — tokens de refresco (opacos, almacenados como hash SHA-256).
 * Revocación explícita en logout. Rotación en cada uso.
 * Tiene tenant_id + RLS.
 */
export const refreshTokens = pgTable(
  'refresh_token',
  {
    id: uuid('id').primaryKey().$defaultFn(() => newId()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    usuarioId: uuid('usuario_id')
      .notNull()
      .references(() => usuarios.id),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revocado: boolean('revocado').notNull().default(false),
    ...auditColumns,
  },
  (t) => ({
    tenantIdx: index('refresh_token_tenant_id_idx').on(t.tenantId),
    usuarioIdx: index('refresh_token_usuario_id_idx').on(t.usuarioId),
  }),
);

export type RolInsert = typeof roles.$inferInsert;
export type RolSelect = typeof roles.$inferSelect;
export type RolPermisoInsert = typeof rolPermisos.$inferInsert;
export type RolPermisoSelect = typeof rolPermisos.$inferSelect;
export type UsuarioRolEmpresaInsert = typeof usuarioRolEmpresa.$inferInsert;
export type UsuarioRolEmpresaSelect = typeof usuarioRolEmpresa.$inferSelect;
export type UsuarioRolProyectoInsert = typeof usuarioRolProyecto.$inferInsert;
export type UsuarioRolProyectoSelect = typeof usuarioRolProyecto.$inferSelect;
export type RefreshTokenInsert = typeof refreshTokens.$inferInsert;
export type RefreshTokenSelect = typeof refreshTokens.$inferSelect;
