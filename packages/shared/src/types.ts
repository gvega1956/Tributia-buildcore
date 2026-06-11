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
