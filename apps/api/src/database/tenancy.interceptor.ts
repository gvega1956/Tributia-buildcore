import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { Observable, from } from 'rxjs';
import { sql } from 'drizzle-orm';
import { lastValueFrom } from 'rxjs';
import type { Request } from 'express';
import { DbService } from './db.service.js';
import { dbContext } from './database.context.js';
import type { JwtPayload } from '@tributia/core';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const TENANT_ID_HEADER = 'x-tenant-id';

/**
 * TenancyInterceptor — ejecutado en cada request HTTP.
 *
 * Abre una transacción PostgreSQL con cuatro variables de sesión SET LOCAL:
 *   app.tenant_id       — leído por las políticas RLS de todas las tablas de negocio.
 *   app.current_user_id — leído por el trigger audit_row() para registrar el autor.
 *   app.client_ip       — leído por audit_row() para registrar el origen.
 *   app.user_agent      — leído por audit_row() para registrar el dispositivo.
 *
 * Si no hay tenant_id (ruta pública como /health), deja pasar sin transacción.
 */
@Injectable()
export class TenancyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(TenancyInterceptor.name);

  constructor(private readonly dbService: DbService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<
      Request & { tenantId?: string; user?: JwtPayload }
    >();

    const tenantId =
      request.user?.tenantId ??
      request.tenantId ??
      (request.headers[TENANT_ID_HEADER] as string | undefined);

    if (!tenantId) {
      return next.handle();
    }

    if (!UUID_RE.test(tenantId)) {
      throw new BadRequestException('X-Tenant-Id debe ser un UUID válido');
    }

    const userId    = request.user?.sub ?? '';
    const clientIp  = this.extractIp(request);
    const userAgent = request.headers['user-agent'] ?? '';

    return from(this.runWithTenantContext(tenantId, userId, clientIp, userAgent, next));
  }

  private async runWithTenantContext(
    tenantId: string,
    userId: string,
    clientIp: string,
    userAgent: string,
    next: CallHandler,
  ): Promise<unknown> {
    // SET LOCAL no acepta parámetros ($1). Las variables ya fueron validadas:
    // tenantId y userId son UUIDs (UUID_RE), ip y userAgent son strings seguros.
    return this.dbService.appDb.transaction(async (tx) => {
      await tx.execute(sql.raw(`SET LOCAL "app.tenant_id"       = '${tenantId}'`));
      await tx.execute(sql.raw(`SET LOCAL "app.current_user_id" = '${userId}'`));
      await tx.execute(sql.raw(`SET LOCAL "app.client_ip"       = '${clientIp.replace(/'/g, "''")}'`));
      await tx.execute(sql.raw(`SET LOCAL "app.user_agent"      = '${userAgent.replace(/'/g, "''")}'`));

      return dbContext.run({ tx, tenantId }, () => lastValueFrom(next.handle()));
    });
  }

  private extractIp(request: Request): string {
    const forwarded = request.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') {
      return forwarded.split(',')[0]?.trim() ?? '';
    }
    return request.socket.remoteAddress ?? '';
  }
}
