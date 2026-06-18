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
import { ApiZodBody } from '../shared/api-zod-body.decorator.js';
import type { Request as ExpressRequest } from 'express';
import type { JwtPayload } from '@tributia/core';
import { PERMISSIONS } from '@tributia/core';
import { zAlmacenCreate, zAlmacenUpdate, zUbicacionCreate } from '@tributia/inventario';
import { RequireAuth } from '../iam/decorators/require-auth.decorator.js';
import { RequirePermission } from '../iam/decorators/require-permission.decorator.js';
import { AlmacenService } from './almacen.service.js';

type AuthRequest = ExpressRequest & { user: JwtPayload };

@ApiTags('Inventario / Almacenes')
@ApiBearerAuth()
@Controller('api/v1/inventario/almacenes')
export class AlmacenController {
  constructor(private readonly almacenService: AlmacenService) {}

  @Get()
  @RequireAuth()
  @RequirePermission(PERMISSIONS.INVENTARIO_READ)
  @ApiOperation({ summary: 'Lista almacenes del tenant' })
  @ApiQuery({ name: 'empresaId', required: false })
  findAll(@Request() req: AuthRequest, @Query('empresaId') empresaId?: string) {
    return this.almacenService.findAll(req.user.tenantId, empresaId);
  }

  @Get(':id')
  @RequireAuth()
  @RequirePermission(PERMISSIONS.INVENTARIO_READ)
  @ApiOperation({ summary: 'Detalle de un almacén' })
  findOne(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.almacenService.findById(req.user.tenantId, id);
  }

  @Post()
  @RequireAuth()
  @RequirePermission(PERMISSIONS.INVENTARIO_WRITE)
  @ApiOperation({ summary: 'Crear almacén' })
  @ApiZodBody(zAlmacenCreate)
  create(@Body() body: unknown, @Request() req: AuthRequest) {
    const input = zAlmacenCreate.parse(body);
    return this.almacenService.create(req.user.tenantId, req.user.sub, input);
  }

  @Patch(':id')
  @RequireAuth()
  @RequirePermission(PERMISSIONS.INVENTARIO_WRITE)
  @ApiOperation({ summary: 'Actualizar almacén' })
  @ApiZodBody(zAlmacenUpdate)
  update(@Param('id') id: string, @Body() body: unknown, @Request() req: AuthRequest) {
    const input = zAlmacenUpdate.parse(body);
    return this.almacenService.update(req.user.tenantId, req.user.sub, id, input);
  }

  @Get(':id/ubicaciones')
  @RequireAuth()
  @RequirePermission(PERMISSIONS.INVENTARIO_READ)
  @ApiOperation({ summary: 'Ubicaciones de un almacén' })
  findUbicaciones(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.almacenService.findUbicaciones(req.user.tenantId, id);
  }

  @Post(':id/ubicaciones')
  @RequireAuth()
  @RequirePermission(PERMISSIONS.INVENTARIO_WRITE)
  @ApiOperation({ summary: 'Agregar ubicación a almacén' })
  @ApiZodBody(zUbicacionCreate)
  addUbicacion(@Param('id') id: string, @Body() body: unknown, @Request() req: AuthRequest) {
    const input = zUbicacionCreate.parse(body);
    return this.almacenService.addUbicacion(req.user.tenantId, req.user.sub, id, input);
  }
}
