import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Request,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import type { Request as ExpressRequest } from 'express';
import { EquipoCatalogoService } from './equipo-catalogo.service.js';
import { RequirePermission } from '../iam/decorators/require-permission.decorator.js';
import { PERMISSIONS } from '@tributia/core';
import { zEquipoCatalogoCreate, zEquipoCatalogoUpdate } from '@tributia/catalogos';
import { ApiZodBody } from '../shared/api-zod-body.decorator.js';
import type { JwtPayload } from '@tributia/core';

@ApiTags('equipos-catalogo')
@ApiBearerAuth()
@Controller('api/v1/equipos-catalogo')
export class EquipoCatalogoController {
  constructor(private readonly service: EquipoCatalogoService) {}

  @Get()
  @RequirePermission(PERMISSIONS.EQUIPO_CATALOGO_READ)
  @ApiOperation({ summary: 'Listar equipos del catálogo del tenant' })
  @ApiResponse({ status: 200 })
  findAll(@Request() req: ExpressRequest & { user: JwtPayload }) {
    return this.service.findAll(req.user.tenantId);
  }

  @Post()
  @RequirePermission(PERMISSIONS.EQUIPO_CATALOGO_WRITE)
  @ApiOperation({ summary: 'Crear equipo en el catálogo' })
  @ApiZodBody(zEquipoCatalogoCreate)
  @ApiResponse({ status: 201 })
  @ApiResponse({ status: 409, description: 'Código duplicado' })
  create(
    @Body() body: unknown,
    @Request() req: ExpressRequest & { user: JwtPayload },
  ) {
    const input = zEquipoCatalogoCreate.parse(body);
    return this.service.create(req.user.tenantId, req.user.sub, input);
  }

  @Get(':id')
  @RequirePermission(PERMISSIONS.EQUIPO_CATALOGO_READ)
  @ApiOperation({ summary: 'Obtener equipo por ID' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404 })
  findOne(@Param('id') id: string) {
    return this.service.findById(id);
  }

  @Patch(':id')
  @RequirePermission(PERMISSIONS.EQUIPO_CATALOGO_WRITE)
  @ApiOperation({ summary: 'Actualizar equipo (parcial)' })
  @ApiZodBody(zEquipoCatalogoUpdate)
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404 })
  update(
    @Param('id') id: string,
    @Body() body: unknown,
    @Request() req: ExpressRequest & { user: JwtPayload },
  ) {
    const input = zEquipoCatalogoUpdate.parse(body);
    return this.service.update(id, req.user.sub, input);
  }
}
