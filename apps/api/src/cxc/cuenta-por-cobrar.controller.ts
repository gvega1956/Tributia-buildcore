import { Controller, Get, Post, Param, Body, Request, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import type { Request as ExpressRequest } from 'express';
import type { JwtPayload } from '@tributia/core';
import { PERMISSIONS } from '@tributia/core';
import { z } from 'zod';
import { RequireAuth } from '../iam/decorators/require-auth.decorator.js';
import { RequirePermission } from '../iam/decorators/require-permission.decorator.js';
import { CuentaPorCobrarService } from './cuenta-por-cobrar.service.js';
import { AgingService } from './aging.service.js';

type AuthRequest = ExpressRequest & { user: JwtPayload };

@ApiTags('CxC / Cuentas por Cobrar')
@ApiBearerAuth()
@Controller('api/v1/cxc/cuentas-por-cobrar')
export class CuentaPorCobrarController {
  constructor(
    private readonly svc: CuentaPorCobrarService,
    private readonly aging: AgingService,
  ) {}

  @Get()
  @RequireAuth()
  @RequirePermission(PERMISSIONS.CXC_READ)
  @ApiOperation({ summary: 'Lista cuentas por cobrar del tenant' })
  @ApiQuery({ name: 'terceroId', required: false })
  @ApiQuery({ name: 'proyectoId', required: false })
  listar(
    @Request() req: AuthRequest,
    @Query('terceroId') terceroId?: string,
    @Query('proyectoId') proyectoId?: string,
  ) {
    return this.svc.listar(req.user.tenantId, terceroId, proyectoId);
  }

  @Get('aging/por-cliente')
  @RequireAuth()
  @RequirePermission(PERMISSIONS.CXC_READ)
  @ApiOperation({ summary: 'Antigüedad de saldos (aging) de CxC agrupada por cliente' })
  agingPorCliente(@Request() req: AuthRequest) {
    return this.aging.porCliente(req.user.tenantId);
  }

  @Get('aging/por-proyecto')
  @RequireAuth()
  @RequirePermission(PERMISSIONS.CXC_READ)
  @ApiOperation({ summary: 'Antigüedad de saldos (aging) de CxC agrupada por proyecto' })
  agingPorProyecto(@Request() req: AuthRequest) {
    return this.aging.porProyecto(req.user.tenantId);
  }

  @Get(':id')
  @RequireAuth()
  @RequirePermission(PERMISSIONS.CXC_READ)
  @ApiOperation({ summary: 'Detalle de cuenta por cobrar' })
  findOne(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.svc.findById(req.user.tenantId, id);
  }

  @Post(':id/cobro')
  @RequireAuth()
  @RequirePermission(PERMISSIONS.CXC_WRITE)
  @ApiOperation({ summary: 'Registrar cobro total o parcial de una CxC' })
  registrarCobro(@Param('id') id: string, @Body() body: { monto: string }, @Request() req: AuthRequest) {
    const monto = z
      .string()
      .regex(/^\d+(\.\d{1,4})?$/)
      .parse(body.monto);
    return this.svc.registrarCobro(req.user.tenantId, id, monto, req.user.sub);
  }
}
