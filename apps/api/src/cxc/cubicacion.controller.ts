import { Controller, Get, Post, Param, Body, Request, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { ApiZodBody } from '../shared/api-zod-body.decorator.js';
import type { Request as ExpressRequest } from 'express';
import type { JwtPayload } from '@tributia/core';
import { PERMISSIONS } from '@tributia/core';
import { RequireAuth } from '../iam/decorators/require-auth.decorator.js';
import { RequirePermission } from '../iam/decorators/require-permission.decorator.js';
import { CubicacionService, zCubicacionCreateDto } from './cubicacion.service.js';

type AuthRequest = ExpressRequest & { user: JwtPayload };

@ApiTags('CxC / Cubicaciones')
@ApiBearerAuth()
@Controller('api/v1/cxc/cubicaciones')
export class CubicacionController {
  constructor(private readonly svc: CubicacionService) {}

  @Get()
  @RequireAuth()
  @RequirePermission(PERMISSIONS.CUBICACION_READ)
  @ApiOperation({ summary: 'Lista cubicaciones del tenant' })
  @ApiQuery({ name: 'proyectoId', required: false })
  listar(@Request() req: AuthRequest, @Query('proyectoId') proyectoId?: string) {
    return this.svc.findAll(req.user.tenantId, proyectoId);
  }

  @Get(':id')
  @RequireAuth()
  @RequirePermission(PERMISSIONS.CUBICACION_READ)
  @ApiOperation({ summary: 'Detalle de una cubicación con sus líneas' })
  findOne(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.svc.findById(req.user.tenantId, id);
  }

  @Post()
  @RequireAuth()
  @RequirePermission(PERMISSIONS.CUBICACION_WRITE)
  @ApiOperation({
    summary: 'Certificar avance facturable por período (no puede superar el avance físico aprobado)',
  })
  @ApiZodBody(zCubicacionCreateDto)
  crear(@Body() body: unknown, @Request() req: AuthRequest) {
    const dto = zCubicacionCreateDto.parse(body);
    return this.svc.crear(req.user.tenantId, dto, req.user.sub);
  }
}
