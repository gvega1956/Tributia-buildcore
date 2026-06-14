import { SetMetadata } from '@nestjs/common';
import type { PermissionCode } from '@tributia/core';

export const PERMISSION_KEY = 'iam:permission';

/**
 * Declara el permiso de negocio requerido para acceder a este endpoint.
 * El código debe pertenecer al catálogo cerrado PERMISSIONS de @tributia/core.
 *
 * Un endpoint SIN esta decoración NI @Public() NI @RequireAuth() provoca
 * un error en arranque de la aplicación (ver IamBootstrapService).
 */
export const RequirePermission = (permission: PermissionCode) =>
  SetMetadata(PERMISSION_KEY, permission);
