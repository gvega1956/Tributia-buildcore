import { SetMetadata } from '@nestjs/common';

export const IS_AUTH_ONLY_KEY = 'iam:auth-only';

/**
 * Requiere JWT válido pero no un permiso de negocio específico.
 * Usar para endpoints de infraestructura de sesión (logout, me, cambiar contraseña).
 */
export const RequireAuth = () => SetMetadata(IS_AUTH_ONLY_KEY, true);
