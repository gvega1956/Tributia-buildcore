import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { eq, and } from 'drizzle-orm';
import { DbService } from '../../database/db.service.js';
import { PERMISSION_KEY } from '../decorators/require-permission.decorator.js';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';
import { IS_AUTH_ONLY_KEY } from '../decorators/require-auth.decorator.js';
import type { JwtPayload } from '@tributia/core';
import * as schema from '../../db/schema/index.js';
import type { Request } from 'express';

/**
 * Guard global que verifica el permiso de negocio declarado en @RequirePermission.
 * Se ejecuta DESPUÉS de JwtAuthGuard (que ya validó el JWT y cargó request.user).
 *
 * Usa adminDb con WHERE explícito (tenant_id + usuario_id) porque el guard
 * corre antes del TenancyInterceptor que establece el contexto RLS.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly db: DbService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const isAuthOnly = this.reflector.getAllAndOverride<boolean>(IS_AUTH_ONLY_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isAuthOnly) return true;

    const requiredPermission = this.reflector.getAllAndOverride<string>(PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // No debería llegar aquí si IamBootstrapService hizo su trabajo.
    if (!requiredPermission) {
      throw new ForbiddenException('Endpoint sin permiso declarado');
    }

    const req = context.switchToHttp().getRequest<Request & { user: JwtPayload }>();
    const { sub: usuarioId, tenantId, empresaId } = req.user;

    const hasPermission = await this.checkPermission(usuarioId, tenantId, empresaId, requiredPermission);
    if (!hasPermission) {
      throw new ForbiddenException(`Sin permiso: ${requiredPermission}`);
    }

    return true;
  }

  private async checkPermission(
    usuarioId: string,
    tenantId: string,
    empresaId: string,
    permiso: string,
  ): Promise<boolean> {
    const rows = await this.db.adminDb
      .select({ permiso: schema.rolPermisos.permiso })
      .from(schema.rolPermisos)
      .innerJoin(
        schema.usuarioRolEmpresa,
        and(
          eq(schema.rolPermisos.rolId, schema.usuarioRolEmpresa.rolId),
          eq(schema.usuarioRolEmpresa.tenantId, tenantId),
        ),
      )
      .where(
        and(
          eq(schema.usuarioRolEmpresa.usuarioId, usuarioId),
          eq(schema.usuarioRolEmpresa.empresaId, empresaId),
          eq(schema.usuarioRolEmpresa.tenantId, tenantId),
          eq(schema.rolPermisos.permiso, permiso),
        ),
      )
      .limit(1);

    return rows.length > 0;
  }
}
