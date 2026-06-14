import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import type { Request as ExpressRequest } from 'express';
import { TipoFlujoService } from './tipo-flujo.service.js';
import { RequirePermission } from '../iam/decorators/require-permission.decorator.js';
import { PERMISSIONS } from '@tributia/core';
import { zCrearTipoFlujo, zAgregarPasoFlujo } from '@tributia/workflow';
import type { JwtPayload } from '@tributia/core';

@ApiTags('workflow/tipos-flujo')
@ApiBearerAuth()
@Controller('api/v1/workflow/tipos-flujo')
export class TipoFlujoController {
  constructor(private readonly service: TipoFlujoService) {}

  @Get()
  @RequirePermission(PERMISSIONS.FLUJO_ADMIN)
  @ApiOperation({ summary: 'Listar tipos de flujo del tenant' })
  @ApiResponse({ status: 200 })
  list(@Request() req: ExpressRequest & { user: JwtPayload }) {
    return this.service.listByTenant(req.user.tenantId);
  }

  @Post()
  @RequirePermission(PERMISSIONS.FLUJO_ADMIN)
  @ApiOperation({ summary: 'Crear tipo de flujo de aprobación' })
  @ApiResponse({ status: 201 })
  crear(
    @Body() body: unknown,
    @Request() req: ExpressRequest & { user: JwtPayload },
  ) {
    const input = zCrearTipoFlujo.parse(body);
    return this.service.crearTipoFlujo(req.user.tenantId, req.user.sub, input);
  }

  @Get(':id/pasos')
  @RequirePermission(PERMISSIONS.FLUJO_ADMIN)
  @ApiOperation({ summary: 'Listar pasos de un tipo de flujo' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404 })
  listPasos(@Param('id') id: string) {
    return this.service.listPasos(id);
  }

  @Post(':id/pasos')
  @RequirePermission(PERMISSIONS.FLUJO_ADMIN)
  @ApiOperation({ summary: 'Añadir paso a un tipo de flujo' })
  @ApiResponse({ status: 201 })
  @ApiResponse({ status: 404 })
  agregarPaso(
    @Param('id') id: string,
    @Body() body: unknown,
    @Request() req: ExpressRequest & { user: JwtPayload },
  ) {
    const input = zAgregarPasoFlujo.parse(body);
    return this.service.agregarPaso(id, req.user.tenantId, req.user.sub, input);
  }
}
