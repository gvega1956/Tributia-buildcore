import {
  Controller,
  Post,
  Patch,
  Get,
  Param,
  Body,
  Query,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import type { Request as ExpressRequest } from 'express';
import type { JwtPayload } from '@tributia/core';
import { PERMISSIONS } from '@tributia/core';
import { RequireAuth } from '../iam/decorators/require-auth.decorator.js';
import { RequirePermission } from '../iam/decorators/require-permission.decorator.js';
import {
  PunchListService,
  zPunchListCreateDto,
  zPunchListActualizarEstadoDto,
} from './punch-list.service.js';

type AuthRequest = ExpressRequest & { user: JwtPayload };

@ApiTags('Obra / Punch List')
@ApiBearerAuth()
@Controller('api/v1/obra/punch-list')
export class PunchListController {
  constructor(private readonly svc: PunchListService) {}

  @Post()
  @RequireAuth()
  @RequirePermission(PERMISSIONS.RFI_WRITE)
  @ApiOperation({ summary: 'Crear ítem de punch list' })
  crear(@Body() body: unknown, @Request() req: AuthRequest) {
    const dto = zPunchListCreateDto.parse(body);
    return this.svc.crear(req.user.tenantId, dto, req.user.sub);
  }

  @Patch(':id/estado')
  @RequireAuth()
  @RequirePermission(PERMISSIONS.RFI_WRITE)
  @ApiOperation({ summary: 'Actualizar estado del ítem (EN_PROGRESO, COMPLETADO, RECHAZADO)' })
  actualizarEstado(
    @Param('id') id: string,
    @Body() body: unknown,
    @Request() req: AuthRequest,
  ) {
    const dto = zPunchListActualizarEstadoDto.parse(body);
    return this.svc.actualizarEstado(req.user.tenantId, id, dto, req.user.sub);
  }

  @Get()
  @RequireAuth()
  @RequirePermission(PERMISSIONS.RFI_WRITE)
  @ApiOperation({ summary: 'Listar ítems de punch list (filtrable por proyecto)' })
  findAll(@Query('proyectoId') proyectoId: string | undefined, @Request() req: AuthRequest) {
    return this.svc.findAll(req.user.tenantId, proyectoId);
  }

  @Get(':id')
  @RequireAuth()
  @RequirePermission(PERMISSIONS.RFI_WRITE)
  @ApiOperation({ summary: 'Detalle de ítem de punch list' })
  findOne(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.svc.findById(req.user.tenantId, id);
  }
}
