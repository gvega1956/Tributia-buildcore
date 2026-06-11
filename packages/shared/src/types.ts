export interface AuditFields {
  createdAt: Date;
  createdBy: string;
  updatedAt: Date;
  updatedBy: string;
}

export interface SoftDelete {
  deletedAt: Date | null;
  deletedBy: string | null;
}

export interface TenantScoped {
  tenantId: string;
}

/** UUID v7 reservado para registros creados por el sistema (seeds, migraciones). */
export const SYSTEM_USER_ID = '00000000-0000-7000-0000-000000000000';
