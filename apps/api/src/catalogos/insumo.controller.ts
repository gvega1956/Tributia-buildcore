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
import { InsumoService } from './insumo.service.js';
import { RequirePermission } from '../iam/decorators/require-permission.decorator.js';
import { PERMISSIONS } from '@tributia/core';
import {
  zUnidadMedidaCreate,
  zInsumoCreate,
  zInsumoUpdate,
  zEquivalenciaCreate,
} from '@tributia/catalogos';
import type { JwtPayload } from '@tributia/core';

@ApiTags('insumos')
@ApiBearerAuth()
@Controller('api/v1')
export class InsumoController {
  constructor(private readonly service: InsumoService) {}

  // ── Unidades de medida ───────────────────────────────────────────────────

  @Get('unidades-medida')
  @RequirePermission(PERMISSIONS.UNIDAD_MEDIDA_READ)
  @ApiOperation({ summary: 'Listar unidades de medida del tenant' })
  @ApiResponse({ status: 200 })
  listUnidades(@Request() req: ExpressRequest & { user: JwtPayload }) {
    return this.service.listUnidades(req.user.tenantId);
  }

  @Post('unidades-medida')
  @RequirePermission(PERMISSIONS.UNIDAD_MEDIDA_WRITE)
  @ApiOperation({ summary: 'Crear unidad de medida' })
  @ApiResponse({ status: 201 })
  @ApiResponse({ status: 409, description: 'Código duplicado' })
  createUnidad(
    @Body() body: unknown,
    @Request() req: ExpressRequest & { user: JwtPayload },
  ) {
    const input = zUnidadMedidaCreate.parse(body);
    return this.service.createUnidad(req.user.tenantId, req.user.sub, input);
  }

  // ── Insumos ──────────────────────────────────────────────────────────────

  @Get('insumos')
  @RequirePermission(PERMISSIONS.INSUMO_READ)
  @ApiOperation({ summary: 'Listar insumos activos del tenant' })
  @ApiResponse({ status: 200 })
  findAll(@Request() req: ExpressRequest & { user: JwtPayload }) {
    return this.service.findAll(req.user.tenantId);
  }

  @Post('insumos')
  @RequirePermission(PERMISSIONS.INSUMO_WRITE)
  @ApiOperation({ summary: 'Crear insumo' })
  @ApiResponse({ status: 201 })
  @ApiResponse({ status: 409, description: 'Código duplicado' })
  create(
    @Body() body: unknown,
    @Request() req: ExpressRequest & { user: JwtPayload },
  ) {
    const input = zInsumoCreate.parse(body);
    return this.service.create(req.user.tenantId, req.user.sub, input);
  }

  @Get('insumos/:id')
  @RequirePermission(PERMISSIONS.INSUMO_READ)
  @ApiOperation({ summary: 'Obtener insumo por ID' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404 })
  findOne(@Param('id') id: string) {
    return this.service.findById(id);
  }

  @Patch('insumos/:id')
  @RequirePermission(PERMISSIONS.INSUMO_WRITE)
  @ApiOperation({ summary: 'Actualizar insumo (parcial)' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404 })
  update(
    @Param('id') id: string,
    @Body() body: unknown,
    @Request() req: ExpressRequest & { user: JwtPayload },
  ) {
    const input = zInsumoUpdate.parse(body);
    return this.service.update(id, req.user.sub, input);
  }

  @Post('insumos/:id/equivalencias')
  @RequirePermission(PERMISSIONS.INSUMO_WRITE)
  @ApiOperation({ summary: 'Añadir equivalencia de unidades al insumo' })
  @ApiResponse({ status: 201 })
  @ApiResponse({ status: 409, description: 'Equivalencia duplicada' })
  addEquivalencia(
    @Param('id') id: string,
    @Body() body: unknown,
    @Request() req: ExpressRequest & { user: JwtPayload },
  ) {
    const input = zEquivalenciaCreate.parse(body);
    return this.service.addEquivalencia(id, req.user.tenantId, req.user.sub, input);
  }
}
