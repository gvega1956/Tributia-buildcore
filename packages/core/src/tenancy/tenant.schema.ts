import { z } from 'zod';
import { zUUID } from '@tributia/shared';

export const zTenant = z.object({
  id: zUUID,
  nombre: z.string().min(1).max(200),
  slug: z.string().min(1).max(50).regex(/^[a-z0-9-]+$/),
  activo: z.boolean().default(true),
});

export type Tenant = z.infer<typeof zTenant>;

export const zEmpresa = z.object({
  id: zUUID,
  tenantId: zUUID,
  nombre: z.string().min(1).max(200),
  rnc: z.string().length(9).regex(/^\d{9}$/).optional(),
  activo: z.boolean().default(true),
});

export type Empresa = z.infer<typeof zEmpresa>;
