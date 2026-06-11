import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable, from } from 'rxjs';
import { sql } from 'drizzle-orm';
import { lastValueFrom } from 'rxjs';
import type { Request } from 'express';
import { DbService } from './db.service.js';
import { dbContext } from './database.context.js';

/**
 * Header provisional hasta que Session 3 implemente JWT.
 * La Session 3 reemplazará este header por el claim del token.
 */
export const TENANT_ID_HEADER = 'x-tenant-id';

/**
 * TenancyInterceptor — ejecutado en cada request HTTP.
 *
 * 1. Extrae el tenant_id (del JWT en Session 3, del header X-Tenant-Id ahora).
 * 2. Si no hay tenant_id: deja pasar sin transacción (rutas públicas como /health).
 * 3. Si hay tenant_id:
 *    a. Abre transacción en el pool de aplicación (tributia_app, sujeto a RLS).
 *    b. Ejecuta SET LOCAL app.tenant_id = '<uuid>' — efecto limitado a esta TX.
 *    c. Deposita la transacción en AsyncLocalStorage.
 *    d. Ejecuta el handler de NestJS dentro del contexto.
 *    e. COMMIT si el handler termina normalmente, ROLLBACK si lanza.
 */
@Injectable()
export class TenancyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(TenancyInterceptor.name);

  constructor(private readonly dbService: DbService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request & { tenantId?: string }>();

    // Sesión 3: el JWT guard pondrá request.tenantId antes del interceptor.
    // Por ahora: acepta el header X-Tenant-Id (solo para desarrollo/tests).
    const tenantId =
      request.tenantId ?? (request.headers[TENANT_ID_HEADER] as string | undefined);

    if (!tenantId) {
      return next.handle();
    }

    return from(this.runWithTenantContext(tenantId, next));
  }

  private async runWithTenantContext(
    tenantId: string,
    next: CallHandler,
  ): Promise<unknown> {
    // appDb conecta como tributia_app (sujeto a RLS) — NO adminDb.
    return this.dbService.appDb.transaction(async (tx) => {
      // SET LOCAL — efecto limitado a esta transacción; RLS lo usa para filtrar filas.
      await tx.execute(sql`SET LOCAL app.tenant_id = ${tenantId}`);

      return dbContext.run({ tx, tenantId }, () => lastValueFrom(next.handle()));
    });
  }
}
