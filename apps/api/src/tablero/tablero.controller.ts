import { Controller, Get, Param, Query, Request } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import type { Request as ExpressRequest } from 'express';
import type { JwtPayload } from '@tributia/core';
import { PERMISSIONS } from '@tributia/core';
import { RequireAuth } from '../iam/decorators/require-auth.decorator.js';
import { RequirePermission } from '../iam/decorators/require-permission.decorator.js';
import { TableroService } from './tablero.service.js';

type AuthRequest = ExpressRequest & { user: JwtPayload };

@ApiTags('Tablero de Control')
@ApiBearerAuth()
@Controller('api/v1/tablero')
export class TableroController {
  constructor(private readonly svc: TableroService) {}

  @Get('proyecto/:id')
  @RequireAuth()
  @RequirePermission(PERMISSIONS.PROYECTO_READ)
  @ApiOperation({ summary: 'Tablero completo del proyecto: tríada + EVM por partida' })
  tableroProyecto(@Param('id') proyectoId: string, @Request() req: AuthRequest) {
    return this.svc.tableroProyecto(req.user.tenantId, proyectoId);
  }

  @Get('proyecto/:id/partidas')
  @RequireAuth()
  @RequirePermission(PERMISSIONS.PROYECTO_READ)
  @ApiOperation({ summary: 'Tríada + EVM por partida (sin resumen de proyecto)' })
  tableroPartidas(@Param('id') proyectoId: string, @Request() req: AuthRequest) {
    return this.svc.tableroPartidas(req.user.tenantId, proyectoId);
  }

  @Get('proyecto/:id/curva-s')
  @RequireAuth()
  @RequirePermission(PERMISSIONS.PROYECTO_READ)
  @ApiOperation({ summary: 'Curva S: EV y AC acumulados por semana' })
  curvaS(@Param('id') proyectoId: string, @Request() req: AuthRequest) {
    return this.svc.curvaS(req.user.tenantId, proyectoId);
  }

  @Get('partida/:id/trazabilidad')
  @RequireAuth()
  @RequirePermission(PERMISSIONS.PROYECTO_READ)
  @ApiOperation({ summary: 'Trazabilidad P8: eventos que afectaron la partida' })
  trazabilidad(
    @Param('id') partidaId: string,
    @Query('limit') limit: string | undefined,
    @Request() req: AuthRequest,
  ) {
    const lim = limit ? Math.min(parseInt(limit, 10), 200) : 50;
    return this.svc.trazabilidadPartida(req.user.tenantId, partidaId, lim);
  }
}
