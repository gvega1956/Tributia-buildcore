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
  OrdenCambioService,
  zCreateOcDto,
  zAddLineaOcDto,
  zAprobarOcDto,
  zRechazarOcDto,
} from './orden-cambio.service.js';

type AuthRequest = ExpressRequest & { user: JwtPayload };

@ApiTags('Órdenes de Cambio')
@ApiBearerAuth()
@Controller('api/v1/ordenes-cambio')
export class OrdenCambioController {
  constructor(private readonly svc: OrdenCambioService) {}

  @Post()
  @RequireAuth()
  @RequirePermission(PERMISSIONS.ORDEN_CAMBIO_WRITE)
  @ApiOperation({ summary: 'Crear Orden de Cambio en estado BORRADOR' })
  crear(@Body() body: unknown, @Request() req: AuthRequest) {
    const dto = zCreateOcDto.parse(body);
    return this.svc.crear(req.user.tenantId, dto, req.user.sub);
  }

  @Post(':id/lineas')
  @RequireAuth()
  @RequirePermission(PERMISSIONS.ORDEN_CAMBIO_WRITE)
  @ApiOperation({ summary: 'Agregar línea de impacto a una OC BORRADOR' })
  agregarLinea(@Param('id') id: string, @Body() body: unknown, @Request() req: AuthRequest) {
    const dto = zAddLineaOcDto.parse(body);
    return this.svc.agregarLinea(req.user.tenantId, id, dto, req.user.sub);
  }

  @Patch(':id/enviar-al-cliente')
  @RequireAuth()
  @RequirePermission(PERMISSIONS.ORDEN_CAMBIO_WRITE)
  @ApiOperation({ summary: 'Enviar OC al cliente para aprobación (BORRADOR → ENVIADO_CLIENTE)' })
  enviarAlCliente(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.svc.enviarAlCliente(req.user.tenantId, id, req.user.sub);
  }

  @Patch(':id/aprobar')
  @RequireAuth()
  @RequirePermission(PERMISSIONS.ORDEN_CAMBIO_APPROVE)
  @ApiOperation({ summary: 'Aprobar OC — actualiza presupuesto vigente y emite evento' })
  aprobar(@Param('id') id: string, @Body() body: unknown, @Request() req: AuthRequest) {
    const dto = zAprobarOcDto.parse(body);
    return this.svc.aprobar(req.user.tenantId, id, dto, req.user.sub);
  }

  @Patch(':id/rechazar')
  @RequireAuth()
  @RequirePermission(PERMISSIONS.ORDEN_CAMBIO_APPROVE)
  @ApiOperation({ summary: 'Rechazar OC (ENVIADO_CLIENTE → RECHAZADO)' })
  rechazar(@Param('id') id: string, @Body() body: unknown, @Request() req: AuthRequest) {
    const dto = zRechazarOcDto.parse(body);
    return this.svc.rechazar(req.user.tenantId, id, dto, req.user.sub);
  }

  @Patch(':id/anular')
  @RequireAuth()
  @RequirePermission(PERMISSIONS.ORDEN_CAMBIO_WRITE)
  @ApiOperation({ summary: 'Anular OC (BORRADOR | ENVIADO_CLIENTE → ANULADO)' })
  anular(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.svc.anular(req.user.tenantId, id, req.user.sub);
  }

  @Get()
  @RequireAuth()
  @RequirePermission(PERMISSIONS.ORDEN_CAMBIO_READ)
  @ApiOperation({ summary: 'Listar OCs (filtrable por proyectoId)' })
  findAll(@Query('proyectoId') proyectoId: string | undefined, @Request() req: AuthRequest) {
    return this.svc.findAll(req.user.tenantId, proyectoId);
  }

  @Get(':id')
  @RequireAuth()
  @RequirePermission(PERMISSIONS.ORDEN_CAMBIO_READ)
  @ApiOperation({ summary: 'Detalle de una OC con sus líneas' })
  findById(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.svc.findById(req.user.tenantId, id);
  }

  @Get('proyecto/:proyectoId/historial')
  @RequireAuth()
  @RequirePermission(PERMISSIONS.ORDEN_CAMBIO_READ)
  @ApiOperation({ summary: 'Historial de OCs aprobadas por causa (anti-fuga de margen)' })
  historial(@Param('proyectoId') proyectoId: string, @Request() req: AuthRequest) {
    return this.svc.historial(req.user.tenantId, proyectoId);
  }
}
