import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'iam:public';

/**
 * Marca un endpoint como público: no requiere JWT ni permiso alguno.
 * Usar solo para rutas genuinamente abiertas (login, health check).
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
