import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  Request,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import type { Request as ExpressRequest } from 'express';
import { TerceroService } from './tercero.service.js';
import { RequirePermission } from '../iam/decorators/require-permission.decorator.js';
import { PERMISSIONS } from '@tributia/core';
import { zTerceroCreate, zTerceroUpdate } from '@tributia/catalogos';
import type { JwtPayload } from '@tributia/core';
import { ApiZodBody } from '../shared/api-zod-body.decorator.js';

@ApiTags('terceros')
@ApiBearerAuth()
@Controller('api/v1/terceros')
export class TerceroController {
  constructor(private readonly service: TerceroService) {}

  @Get()
  @RequirePermission(PERMISSIONS.TERCERO_READ)
  @ApiOperation({ summary: 'Listar terceros activos del tenant' })
  @ApiResponse({ status: 200, description: 'Lista de terceros' })
  findAll(@Request() req: ExpressRequest & { user: JwtPayload }) {
    return this.service.findAll(req.user.tenantId);
  }

  @Post()
  @RequirePermission(PERMISSIONS.TERCERO_WRITE)
  @ApiOperation({ summary: 'Crear tercero (cliente/proveedor/subcontratista/etc.)' })
  @ApiZodBody(zTerceroCreate)
  @ApiResponse({ status: 201, description: 'Tercero creado' })
  @ApiResponse({ status: 409, description: 'RNC/Cédula duplicada en este tenant' })
  create(
    @Body() body: unknown,
    @Request() req: ExpressRequest & { user: JwtPayload },
  ) {
    const input = zTerceroCreate.parse(body);
    return this.service.create(req.user.tenantId, req.user.sub, input);
  }

  @Get(':id')
  @RequirePermission(PERMISSIONS.TERCERO_READ)
  @ApiOperation({ summary: 'Obtener un tercero por ID' })
  @ApiResponse({ status: 200, description: 'Tercero encontrado' })
  @ApiResponse({ status: 404, description: 'No encontrado' })
  findOne(@Param('id') id: string) {
    return this.service.findById(id);
  }

  @Put(':id')
  @RequirePermission(PERMISSIONS.TERCERO_WRITE)
  @ApiOperation({ summary: 'Actualizar tercero' })
  @ApiZodBody(zTerceroUpdate)
  @ApiResponse({ status: 200, description: 'Tercero actualizado' })
  @ApiResponse({ status: 404, description: 'No encontrado' })
  update(
    @Param('id') id: string,
    @Body() body: unknown,
    @Request() req: ExpressRequest & { user: JwtPayload },
  ) {
    const input = zTerceroUpdate.parse(body);
    return this.service.update(id, req.user.sub, input);
  }

  @Delete(':id')
  @RequirePermission(PERMISSIONS.TERCERO_WRITE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Eliminar (soft-delete) tercero' })
  @ApiResponse({ status: 204, description: 'Tercero eliminado' })
  @ApiResponse({ status: 404, description: 'No encontrado' })
  async remove(
    @Param('id') id: string,
    @Request() req: ExpressRequest & { user: JwtPayload },
  ) {
    await this.service.softDelete(id, req.user.sub);
  }
}
