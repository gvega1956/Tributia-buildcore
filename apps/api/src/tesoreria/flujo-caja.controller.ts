import { Controller, Get, Post, Delete, Param, Body, Query, Request } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { ApiZodBody } from '../shared/api-zod-body.decorator.js';
import { z } from 'zod';
import type { Request as ExpressRequest } from 'express';
import type { JwtPayload } from '@tributia/core';
import { PERMISSIONS } from '@tributia/core';
import { RequireAuth } from '../iam/decorators/require-auth.decorator.js';
import { RequirePermission } from '../iam/decorators/require-permission.decorator.js';
import { FlujoCajaService } from './flujo-caja.service.js';

type AuthRequest = ExpressRequest & { user: JwtPayload };

const zCubicacionProyectada = z.object({
  empresaId: z.string().uuid(),
  proyectoId: z.string().uuid(),
  fechaProyectada: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  montoProyectado: z.string(),
  moneda: z.string().length(3).optional(),
  descripcion: z.string().max(500).optional(),
});

const MAX_HORIZONTE = 52;
const DEFAULT_HORIZONTE = 13;

function parseHorizonte(h: string | undefined): number {
  const n = h ? parseInt(h, 10) : DEFAULT_HORIZONTE;
  if (isNaN(n) || n < 1 || n > MAX_HORIZONTE) return DEFAULT_HORIZONTE;
  return n;
}

@ApiTags('Tesorería / Flujo de Caja Proyectado')
@ApiBearerAuth()
@Controller('')
export class FlujoCajaController {
  constructor(private readonly flujoCajaSvc: FlujoCajaService) {}

  // ── Flujo por proyecto ────────────────────────────────────────────────────

  @Get('api/v1/proyectos/:proyectoId/flujo-caja')
  @RequireAuth()
  @RequirePermission(PERMISSIONS.FLUJO_CAJA_READ)
  @ApiOperation({ summary: 'Flujo de caja proyectado por proyecto (13 semanas por defecto)' })
  @ApiQuery({ name: 'horizonte', required: false, description: '1–52 semanas' })
  flujoPorProyecto(
    @Param('proyectoId') proyectoId: string,
    @Query('horizonte') horizonte: string | undefined,
    @Request() req: AuthRequest,
  ) {
    return this.flujoCajaSvc.calcularFlujoPorProyecto(
      req.user.tenantId,
      proyectoId,
      parseHorizonte(horizonte),
    );
  }

  // ── Flujo consolidado ─────────────────────────────────────────────────────

  @Get('api/v1/tesoreria/flujo-caja')
  @RequireAuth()
  @RequirePermission(PERMISSIONS.FLUJO_CAJA_READ)
  @ApiOperation({ summary: 'Flujo de caja consolidado de una empresa (con saldo bancario inicial real)' })
  @ApiQuery({ name: 'empresaId', required: true })
  @ApiQuery({ name: 'horizonte', required: false, description: '1–52 semanas' })
  flujoConsolidado(
    @Query('empresaId') empresaId: string,
    @Query('horizonte') horizonte: string | undefined,
    @Request() req: AuthRequest,
  ) {
    const eid = z.string().uuid().parse(empresaId);
    return this.flujoCajaSvc.calcularFlujoConsolidado(
      req.user.tenantId,
      eid,
      parseHorizonte(horizonte),
    );
  }

  // ── Cubicaciones proyectadas (CRUD) ───────────────────────────────────────

  @Post('api/v1/proyectos/:proyectoId/cubicaciones-proyectadas')
  @RequireAuth()
  @RequirePermission(PERMISSIONS.FLUJO_CAJA_WRITE)
  @ApiOperation({ summary: 'Registra una cubicación/certificación futura planificada' })
  @ApiZodBody(zCubicacionProyectada)
  registrar(
    @Param('proyectoId') proyectoId: string,
    @Body() body: unknown,
    @Request() req: AuthRequest,
  ) {
    const input = zCubicacionProyectada.parse(body);
    return this.flujoCajaSvc.registrarCubicacionProyectada(req.user.tenantId, req.user.sub, {
      ...input,
      proyectoId,
    });
  }

  @Get('api/v1/proyectos/:proyectoId/cubicaciones-proyectadas')
  @RequireAuth()
  @RequirePermission(PERMISSIONS.FLUJO_CAJA_READ)
  @ApiOperation({ summary: 'Lista las cubicaciones proyectadas de un proyecto' })
  listar(
    @Param('proyectoId') proyectoId: string,
    @Request() req: AuthRequest,
  ) {
    return this.flujoCajaSvc.listarCubicacionesProyectadas(req.user.tenantId, proyectoId);
  }

  @Delete('api/v1/proyectos/:proyectoId/cubicaciones-proyectadas/:id')
  @RequireAuth()
  @RequirePermission(PERMISSIONS.FLUJO_CAJA_WRITE)
  @ApiOperation({ summary: 'Elimina (soft-delete) una cubicación proyectada' })
  eliminar(
    @Param('id') id: string,
    @Request() req: AuthRequest,
  ) {
    return this.flujoCajaSvc.eliminarCubicacionProyectada(req.user.tenantId, id, req.user.sub);
  }
}
