import {
  Controller,
  Get,
  Post,
  Param,
  Request,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import type { Request as ExpressRequest } from 'express';
import { NotificacionService } from './notificacion.service.js';
import { RequirePermission } from '../iam/decorators/require-permission.decorator.js';
import { PERMISSIONS } from '@tributia/core';
import type { JwtPayload } from '@tributia/core';

@ApiTags('notificaciones')
@ApiBearerAuth()
@Controller('api/v1/notificaciones')
export class NotificacionController {
  constructor(private readonly service: NotificacionService) {}

  @Get()
  @RequirePermission(PERMISSIONS.NOTIFICACION_READ)
  @ApiOperation({ summary: 'Listar notificaciones in-app del usuario (incluye leídas)' })
  @ApiResponse({ status: 200 })
  todas(@Request() req: ExpressRequest & { user: JwtPayload }) {
    return this.service.todasPorUsuario(req.user.sub, req.user.tenantId);
  }

  @Get('pendientes')
  @RequirePermission(PERMISSIONS.NOTIFICACION_READ)
  @ApiOperation({ summary: 'Listar notificaciones in-app no leídas del usuario' })
  @ApiResponse({ status: 200 })
  pendientes(@Request() req: ExpressRequest & { user: JwtPayload }) {
    return this.service.pendientesPorUsuario(req.user.sub, req.user.tenantId);
  }

  @Post(':id/leer')
  @RequirePermission(PERMISSIONS.NOTIFICACION_READ)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Marcar notificación como leída' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404 })
  marcarLeida(
    @Param('id') id: string,
    @Request() req: ExpressRequest & { user: JwtPayload },
  ) {
    return this.service.marcarLeida(id, req.user.sub);
  }
}
