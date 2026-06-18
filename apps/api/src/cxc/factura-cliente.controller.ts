import { Controller, Get, Post, Param, Body, Request, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { ApiZodBody } from '../shared/api-zod-body.decorator.js';
import type { Request as ExpressRequest } from 'express';
import type { JwtPayload } from '@tributia/core';
import { PERMISSIONS } from '@tributia/core';
import { RequireAuth } from '../iam/decorators/require-auth.decorator.js';
import { RequirePermission } from '../iam/decorators/require-permission.decorator.js';
import { FacturaClienteService, zFacturaClienteCreateDto } from './factura-cliente.service.js';

type AuthRequest = ExpressRequest & { user: JwtPayload };

@ApiTags('CxC / Factura Cliente')
@ApiBearerAuth()
@Controller('api/v1/cxc/facturas-cliente')
export class FacturaClienteController {
  constructor(private readonly svc: FacturaClienteService) {}

  @Get()
  @RequireAuth()
  @RequirePermission(PERMISSIONS.FACTURA_CLI_READ)
  @ApiOperation({ summary: 'Lista facturas emitidas a clientes' })
  @ApiQuery({ name: 'proyectoId', required: false })
  listar(@Request() req: AuthRequest, @Query('proyectoId') proyectoId?: string) {
    return this.svc.findAll(req.user.tenantId, proyectoId);
  }

  @Get(':id')
  @RequireAuth()
  @RequirePermission(PERMISSIONS.FACTURA_CLI_READ)
  @ApiOperation({ summary: 'Detalle de factura a cliente' })
  findOne(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.svc.findById(req.user.tenantId, id);
  }

  @Post()
  @RequireAuth()
  @RequirePermission(PERMISSIONS.FACTURA_CLI_WRITE)
  @ApiOperation({
    summary:
      'Emite factura al cliente desde una cubicación — calcula retenciones por tipo de tercero y dispara el asiento contable + CxC',
  })
  @ApiZodBody(zFacturaClienteCreateDto)
  emitir(@Body() body: unknown, @Request() req: AuthRequest) {
    const dto = zFacturaClienteCreateDto.parse(body);
    return this.svc.emitir(req.user.tenantId, dto, req.user.sub);
  }
}
