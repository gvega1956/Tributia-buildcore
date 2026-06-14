import { z } from 'zod';
import { zUUID } from '@tributia/shared';

export const zLoginInput = z.object({
  tenantSlug: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[a-z0-9-]+$/, 'Slug inválido'),
  email: z.string().email('Email inválido').max(254),
  password: z.string().min(8).max(128),
});
export type LoginInput = z.infer<typeof zLoginInput>;

export const zRefreshInput = z.object({
  refreshToken: z.string().uuid('Refresh token inválido'),
});
export type RefreshInput = z.infer<typeof zRefreshInput>;

export const zUsuarioPublic = z.object({
  id: zUUID,
  tenantId: zUUID,
  email: z.string().email(),
  nombre: z.string(),
  apellido: z.string(),
  activo: z.boolean(),
});
export type UsuarioPublic = z.infer<typeof zUsuarioPublic>;

export const zRolPublic = z.object({
  id: zUUID,
  nombre: z.string(),
  descripcion: z.string().optional(),
  esSistema: z.boolean(),
  permisos: z.array(z.string()),
});
export type RolPublic = z.infer<typeof zRolPublic>;
