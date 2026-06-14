import {
  Injectable,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';
import type { JwtPayload } from '@tributia/core';
import type { Request } from 'express';

/**
 * Guard global que valida el JWT en cada request.
 * Rutas con @Public() se dejan pasar sin validación.
 * Rutas protegidas: extrae el JWT, llama a JwtStrategy.validate(),
 * y además propaga tenantId al request para TenancyInterceptor.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  override canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    return super.canActivate(context);
  }

  override handleRequest<T extends JwtPayload>(
    err: Error | null,
    user: T | false,
    _info: unknown,
    context: ExecutionContext,
  ): T {
    if (err || !user) {
      throw new UnauthorizedException(err?.message ?? 'No autenticado');
    }

    // Propaga tenantId al request para que TenancyInterceptor lo recoja.
    const req = context.switchToHttp().getRequest<Request & { tenantId?: string }>();
    req.tenantId = user.tenantId;

    return user;
  }
}
