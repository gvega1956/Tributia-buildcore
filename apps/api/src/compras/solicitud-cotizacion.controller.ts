import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import type { Request as ExpressRequest } from 'express';
import type { JwtPayload } from '@tributia/core';
import { PERMISSIONS } from '@tributia/core';
import { zSocCreate } from '@tributia/compras';
import { RequireAuth } from '../iam/decorators/require-auth.decorator.js';
import { RequirePermission } from '../iam/decorators/require-permission.decorator.js';
import { SolicitudCotizacionService } from './solicitud-cotizacion.service.js';

type AuthRequest = ExpressRequest & { user: JwtPayload };

@ApiTags('Compras / Solicitudes de Cotización')
@ApiBearerAuth()
@Controller('api/v1/compras/solicitudes-cotizacion')
export class SolicitudCotizacionController {
  constructor(private readonly socSvc: SolicitudCotizacionService) {}

  @Get()
  @RequireAuth()
  @RequirePermission(PERMISSIONS.OC_READ)
  @ApiOperation({ summary: 'Lista solicitudes de cotización del tenant' })
  findAll(@Request() req: AuthRequest) {
    return this.socSvc.findAll(req.user.tenantId);
  }

  @Get(':id')
  @RequireAuth()
  @RequirePermission(PERMISSIONS.OC_READ)
  @ApiOperation({ summary: 'Detalle de una SOC (incluye líneas y proveedores)' })
  findOne(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.socSvc.findById(req.user.tenantId, id);
  }

  @Post()
  @RequireAuth()
  @RequirePermission(PERMISSIONS.OC_WRITE)
  @ApiOperation({ summary: 'Crear SOC consolidando líneas de requisiciones aprobadas' })
  create(@Body() body: unknown, @Request() req: AuthRequest) {
    const input = zSocCreate.parse(body);
    return this.socSvc.create(req.user.tenantId, req.user.sub, input);
  }

  @Patch(':id/enviar')
  @RequireAuth()
  @RequirePermission(PERMISSIONS.OC_WRITE)
  @ApiOperation({ summary: 'Enviar SOC a proveedores' })
  enviar(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.socSvc.enviar(req.user.tenantId, req.user.sub, id);
  }
}
