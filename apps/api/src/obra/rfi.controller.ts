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
import { RfiService, zRfiCreateDto, zRfiResponderDto } from './rfi.service.js';

type AuthRequest = ExpressRequest & { user: JwtPayload };

@ApiTags('Obra / RFI')
@ApiBearerAuth()
@Controller('api/v1/obra/rfis')
export class RfiController {
  constructor(private readonly svc: RfiService) {}

  @Post()
  @RequireAuth()
  @RequirePermission(PERMISSIONS.RFI_WRITE)
  @ApiOperation({ summary: 'Crear RFI (Request for Information)' })
  crear(@Body() body: unknown, @Request() req: AuthRequest) {
    const dto = zRfiCreateDto.parse(body);
    return this.svc.crear(req.user.tenantId, dto, req.user.sub);
  }

  @Patch(':id/responder')
  @RequireAuth()
  @RequirePermission(PERMISSIONS.RFI_WRITE)
  @ApiOperation({ summary: 'Responder RFI — cambia estado a RESPONDIDO' })
  responder(@Param('id') id: string, @Body() body: unknown, @Request() req: AuthRequest) {
    const dto = zRfiResponderDto.parse(body);
    return this.svc.responder(req.user.tenantId, id, dto, req.user.sub);
  }

  @Patch(':id/cerrar')
  @RequireAuth()
  @RequirePermission(PERMISSIONS.RFI_WRITE)
  @ApiOperation({ summary: 'Cerrar RFI — estado CERRADO (idempotente)' })
  cerrar(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.svc.cerrar(req.user.tenantId, id, req.user.sub);
  }

  @Get()
  @RequireAuth()
  @RequirePermission(PERMISSIONS.RFI_WRITE)
  @ApiOperation({ summary: 'Listar RFIs (filtrable por proyecto)' })
  findAll(@Query('proyectoId') proyectoId: string | undefined, @Request() req: AuthRequest) {
    return this.svc.findAll(req.user.tenantId, proyectoId);
  }

  @Get(':id')
  @RequireAuth()
  @RequirePermission(PERMISSIONS.RFI_WRITE)
  @ApiOperation({ summary: 'Detalle de un RFI' })
  findOne(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.svc.findById(req.user.tenantId, id);
  }
}
