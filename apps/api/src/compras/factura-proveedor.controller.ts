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
import { RequireAuth } from '../iam/decorators/require-auth.decorator.js';
import { RequirePermission } from '../iam/decorators/require-permission.decorator.js';
import {
  FacturaProveedorService,
  zFacturaProveedorCreate,
} from './factura-proveedor.service.js';

type AuthRequest = ExpressRequest & { user: JwtPayload };

@ApiTags('Compras / Facturas Proveedor')
@ApiBearerAuth()
@Controller('api/v1/compras/facturas-proveedor')
export class FacturaProveedorController {
  constructor(private readonly svc: FacturaProveedorService) {}

  @Get()
  @RequireAuth()
  @RequirePermission(PERMISSIONS.FACTURA_PROV_READ)
  @ApiOperation({ summary: 'Lista facturas de proveedor del tenant' })
  @ApiQuery({ name: 'empresaId', required: false })
  findAll(@Request() req: AuthRequest, @Query('empresaId') empresaId?: string) {
    return this.svc.findAll(req.user.tenantId, empresaId);
  }

  @Get(':id')
  @RequireAuth()
  @RequirePermission(PERMISSIONS.FACTURA_PROV_READ)
  @ApiOperation({ summary: 'Detalle de factura proveedor con líneas' })
  findOne(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.svc.findById(req.user.tenantId, id);
  }

  @Post()
  @RequireAuth()
  @RequirePermission(PERMISSIONS.FACTURA_PROV_WRITE)
  @ApiOperation({
    summary:
      'Registrar factura proveedor — valida e-CF, calcula match 3 vías, emite evento recepcion_factura_proveedor',
  })
  registrar(@Body() body: unknown, @Request() req: AuthRequest) {
    const dto = zFacturaProveedorCreate.parse(body);
    return this.svc.registrar(req.user.tenantId, dto, req.user.sub);
  }

  @Patch(':id/aprobar-excepcion')
  @RequireAuth()
  @RequirePermission(PERMISSIONS.FACTURA_PROV_WRITE)
  @ApiOperation({
    summary: 'Aprobar excepción de match — pasa a EXCEPCION_APROBADA',
  })
  aprobarExcepcion(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.svc.aprobarExcepcion(req.user.tenantId, id, req.user.sub);
  }
}
