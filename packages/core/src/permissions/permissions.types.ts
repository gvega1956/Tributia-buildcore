export interface Permission {
  code: string;
  description: string;
  module: string;
}

export interface RolePermission {
  roleId: string;
  permissionCode: string;
}
