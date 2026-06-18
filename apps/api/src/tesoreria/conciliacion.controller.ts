import { Controller, Post, Param, Body, Request } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ApiZodBody } from '../shared/api-zod-body.decorator.js';
import { z } from 'zod';
import type { Request as ExpressRequest } from 'express';
import type { JwtPayload } from '@tributia/core';
import { PERMISSIONS } from '@tributia/core';
import { RequireAuth } from '../iam/decorators/require-auth.decorator.js';
import { RequirePermission } from '../iam/decorators/require-permission.decorator.js';
import { ConciliacionBancariaService } from './conciliacion.service.js';

type AuthRequest = ExpressRequest & { user: JwtPayload };

const zLineaExtracto = z.object({
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  descripcion: z.string().min(1).max(500),
  monto: z.string(),
  referencia: z.string().max(100).optional(),
});

const zImportarExtracto = z.object({
  cuentaBancariaId: z.string().uuid(),
  empresaId: z.string().uuid(),
  periodoDesde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  periodoHasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  archivoNombre: z.string().min(1).max(255),
  lineas: z.array(zLineaExtracto),
});

@ApiTags('Tesorería / Conciliación Bancaria')
@ApiBearerAuth()
@Controller('api/v1/tesoreria/conciliacion')
export class ConciliacionController {
  constructor(private readonly svc: ConciliacionBancariaService) {}

  @Post('extractos')
  @RequireAuth()
  @RequirePermission(PERMISSIONS.CONCILIACION_WRITE)
  @ApiOperation({ summary: 'Importa un extracto bancario (estado de cuenta)' })
  @ApiZodBody(zImportarExtracto)
  importarExtracto(@Body() body: unknown, @Request() req: AuthRequest) {
    const input = zImportarExtracto.parse(body);
    return this.svc.importarExtracto(req.user.tenantId, req.user.sub, input);
  }

  @Post('extractos/:extractoId/conciliar-automatico')
  @RequireAuth()
  @RequirePermission(PERMISSIONS.CONCILIACION_WRITE)
  @ApiOperation({ summary: 'Ejecuta conciliación automática de un extracto importado' })
  conciliarAutomatico(@Param('extractoId') extractoId: string, @Request() req: AuthRequest) {
    return this.svc.conciliarAutomatico(req.user.tenantId, req.user.sub, extractoId);
  }

  @Post('lineas/:lineaId/conciliar-manual')
  @RequireAuth()
  @RequirePermission(PERMISSIONS.CONCILIACION_WRITE)
  @ApiOperation({ summary: 'Concilia manualmente una línea de extracto con un movimiento' })
  conciliarManual(
    @Param('lineaId') lineaId: string,
    @Body() body: { movimientoBancarioId: string },
    @Request() req: AuthRequest,
  ) {
    const movId = z.string().uuid().parse(body.movimientoBancarioId);
    return this.svc.conciliarManual(req.user.tenantId, req.user.sub, lineaId, movId);
  }

  @Post('lineas/:lineaId/ignorar')
  @RequireAuth()
  @RequirePermission(PERMISSIONS.CONCILIACION_WRITE)
  @ApiOperation({ summary: 'Marca una línea de extracto como ignorada' })
  ignorarLinea(@Param('lineaId') lineaId: string, @Request() req: AuthRequest) {
    return this.svc.ignorarLinea(req.user.tenantId, req.user.sub, lineaId);
  }
}
