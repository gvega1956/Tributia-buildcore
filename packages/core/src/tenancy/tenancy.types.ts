import type { TenantId, EmpresaId } from '@tributia/shared';

export interface TenantContext {
  tenantId: TenantId;
  empresaId: EmpresaId;
  userId: string;
}
