import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Request,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import type { Request as ExpressRequest } from 'express';
import type { JwtPayload } from '@tributia/core';
import { PERMISSIONS } from '@tributia/core';
import { zCotizacionCreate } from '@tributia/compras';
import { ApiZodBody } from '../shared/api-zod-body.decorator.js';
import { RequireAuth } from '../iam/decorators/require-auth.decorator.js';
import { RequirePermission } from '../iam/decorators/require-permission.decorator.js';
import { CotizacionService } from './cotizacion.service.js';

type AuthRequest = ExpressRequest & { user: JwtPayload };

@ApiTags('Compras / Cotizaciones')
@ApiBearerAuth()
@Controller('api/v1/compras/cotizaciones')
export class CotizacionController {
  constructor(private readonly cotizacionSvc: CotizacionService) {}

  @Get()
  @RequireAuth()
  @RequirePermission(PERMISSIONS.OC_READ)
  @ApiOperation({ summary: 'Lista cotizaciones del tenant' })
  @ApiQuery({ name: 'socId', required: false })
  findAll(@Request() req: AuthRequest, @Query('socId') socId?: string) {
    return this.cotizacionSvc.findAll(req.user.tenantId, socId);
  }

  @Get('soc/:socId/cuadro-comparativo')
  @RequireAuth()
  @RequirePermission(PERMISSIONS.OC_READ)
  @ApiOperation({ summary: 'Cuadro comparativo automático de cotizaciones para una SOC' })
  getCuadroComparativo(@Param('socId') socId: string, @Request() req: AuthRequest) {
    return this.cotizacionSvc.getCuadroComparativo(req.user.tenantId, socId);
  }

  @Get(':id')
  @RequireAuth()
  @RequirePermission(PERMISSIONS.OC_READ)
  @ApiOperation({ summary: 'Detalle de una cotización' })
  findOne(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.cotizacionSvc.findById(req.user.tenantId, id);
  }

  @Post()
  @RequireAuth()
  @RequirePermission(PERMISSIONS.OC_WRITE)
  @ApiOperation({ summary: 'Registrar cotización recibida de un proveedor' })
  @ApiZodBody(zCotizacionCreate)
  registrar(@Body() body: unknown, @Request() req: AuthRequest) {
    const input = zCotizacionCreate.parse(body);
    return this.cotizacionSvc.registrar(req.user.tenantId, req.user.sub, input);
  }

  @Patch(':id/seleccionar')
  @RequireAuth()
  @RequirePermission(PERMISSIONS.OC_APPROVE)
  @ApiOperation({ summary: 'Seleccionar cotización ganadora del cuadro comparativo' })
  seleccionar(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.cotizacionSvc.seleccionar(req.user.tenantId, req.user.sub, id);
  }
}
