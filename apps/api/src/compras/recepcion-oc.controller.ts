import {
  Controller,
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
import { RequireAuth } from '../iam/decorators/require-auth.decorator.js';
import { RequirePermission } from '../iam/decorators/require-permission.decorator.js';
import { RecepcionOcService, zRecepcionOcCreate } from './recepcion-oc.service.js';

type AuthRequest = ExpressRequest & { user: JwtPayload };

@ApiTags('Compras / Recepciones OC')
@ApiBearerAuth()
@Controller('api/v1/compras/recepciones')
export class RecepcionOcController {
  constructor(private readonly svc: RecepcionOcService) {}

  @Post()
  @RequireAuth()
  @RequirePermission(PERMISSIONS.RECEPCION_WRITE)
  @ApiOperation({ summary: 'Crear recepción de OC en estado BORRADOR' })
  crear(@Body() body: unknown, @Request() req: AuthRequest) {
    const dto = zRecepcionOcCreate.parse(body);
    return this.svc.crear(
      req.user.tenantId,
      req.user.empresaId ?? '',
      dto,
      req.user.sub,
    );
  }

  @Patch(':id/confirmar')
  @RequireAuth()
  @RequirePermission(PERMISSIONS.RECEPCION_WRITE)
  @ApiOperation({
    summary:
      'Confirmar recepción — emite evento recepcion_oc, actualiza stock y devengado',
  })
  confirmar(
    @Param('id') id: string,
    @Body() body: { proyectoId: string },
    @Request() req: AuthRequest,
  ) {
    return this.svc.confirmar(
      req.user.tenantId,
      id,
      body.proyectoId,
      req.user.sub,
    );
  }
}
