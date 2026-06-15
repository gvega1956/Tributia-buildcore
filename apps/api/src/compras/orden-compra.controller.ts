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
import { zOrdenCompraCreate } from '@tributia/compras';
import { RequireAuth } from '../iam/decorators/require-auth.decorator.js';
import { RequirePermission } from '../iam/decorators/require-permission.decorator.js';
import { OrdenCompraService } from './orden-compra.service.js';

type AuthRequest = ExpressRequest & { user: JwtPayload };

@ApiTags('Compras / Órdenes de Compra')
@ApiBearerAuth()
@Controller('api/v1/compras/ordenes-compra')
export class OrdenCompraController {
  constructor(private readonly ocSvc: OrdenCompraService) {}

  @Get()
  @RequireAuth()
  @RequirePermission(PERMISSIONS.OC_READ)
  @ApiOperation({ summary: 'Lista órdenes de compra del tenant' })
  @ApiQuery({ name: 'empresaId', required: false })
  findAll(@Request() req: AuthRequest, @Query('empresaId') empresaId?: string) {
    return this.ocSvc.findAll(req.user.tenantId, empresaId);
  }

  @Get(':id')
  @RequireAuth()
  @RequirePermission(PERMISSIONS.OC_READ)
  @ApiOperation({ summary: 'Detalle de una OC con sus líneas' })
  findOne(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.ocSvc.findById(req.user.tenantId, id);
  }

  @Post()
  @RequireAuth()
  @RequirePermission(PERMISSIONS.OC_WRITE)
  @ApiOperation({ summary: 'Crear OC en estado BORRADOR' })
  create(@Body() body: unknown, @Request() req: AuthRequest) {
    const input = zOrdenCompraCreate.parse(body);
    return this.ocSvc.create(req.user.tenantId, req.user.sub, input);
  }

  @Patch(':id/aprobar')
  @RequireAuth()
  @RequirePermission(PERMISSIONS.OC_APPROVE)
  @ApiOperation({ summary: 'Aprobar la OC' })
  aprobar(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.ocSvc.aprobar(req.user.tenantId, req.user.sub, id);
  }

  @Patch(':id/emitir')
  @RequireAuth()
  @RequirePermission(PERMISSIONS.OC_APPROVE)
  @ApiOperation({ summary: 'Emitir OC aprobada — registra evento emision_oc y actualiza comprometido' })
  emitir(@Param('id') id: string, @Request() req: AuthRequest) {
    // empresaId se toma del JWT (usuarioId tiene acceso al tenant, no empresa directa)
    // Para Compras I, la empresa viene de la OC misma
    return this.ocSvc.emitir(req.user.tenantId, req.user.empresaId ?? '', req.user.sub, id);
  }
}
