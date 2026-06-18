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
import { ApiZodBody } from '../shared/api-zod-body.decorator.js';
import type { Request as ExpressRequest } from 'express';
import type { JwtPayload } from '@tributia/core';
import { PERMISSIONS } from '@tributia/core';
import { zRequisicionCreate } from '@tributia/compras';
import { RequireAuth } from '../iam/decorators/require-auth.decorator.js';
import { RequirePermission } from '../iam/decorators/require-permission.decorator.js';
import { RequisicionService } from './requisicion.service.js';
import { DisponibilidadService } from './disponibilidad.service.js';

type AuthRequest = ExpressRequest & { user: JwtPayload };

@ApiTags('Compras / Requisiciones')
@ApiBearerAuth()
@Controller('api/v1/compras/requisiciones')
export class RequisicionController {
  constructor(
    private readonly requisicionSvc: RequisicionService,
    private readonly disponibilidadSvc: DisponibilidadService,
  ) {}

  @Get()
  @RequireAuth()
  @RequirePermission(PERMISSIONS.OC_READ)
  @ApiOperation({ summary: 'Lista requisiciones del tenant' })
  @ApiQuery({ name: 'proyectoId', required: false })
  findAll(@Request() req: AuthRequest, @Query('proyectoId') proyectoId?: string) {
    return this.requisicionSvc.findAll(req.user.tenantId, proyectoId);
  }

  @Get(':id')
  @RequireAuth()
  @RequirePermission(PERMISSIONS.OC_READ)
  @ApiOperation({ summary: 'Detalle de una requisición' })
  findOne(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.requisicionSvc.findById(req.user.tenantId, id);
  }

  @Get(':id/disponible')
  @RequireAuth()
  @RequirePermission(PERMISSIONS.OC_READ)
  @ApiOperation({ summary: 'Disponible por partida para las líneas de la requisición' })
  async getDisponible(@Param('id') id: string, @Request() req: AuthRequest) {
    const req2 = await this.requisicionSvc.findById(req.user.tenantId, id);
    const partidaIds = [...new Set(req2.lineas.map((l) => l.partidaId))];
    return this.disponibilidadSvc.getDisponible(req.user.tenantId, req2.proyectoId, partidaIds);
  }

  @Post()
  @RequireAuth()
  @RequirePermission(PERMISSIONS.REQUISICION_CREATE)
  @ApiOperation({ summary: 'Crear requisición (estado BORRADOR)' })
  @ApiZodBody(zRequisicionCreate)
  create(@Body() body: unknown, @Request() req: AuthRequest) {
    const input = zRequisicionCreate.parse(body);
    return this.requisicionSvc.create(req.user.tenantId, req.user.sub, input);
  }

  @Patch(':id/submit')
  @RequireAuth()
  @RequirePermission(PERMISSIONS.REQUISICION_CREATE)
  @ApiOperation({ summary: 'Someter requisición para aprobación (valida disponible)' })
  submit(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.requisicionSvc.submit(req.user.tenantId, req.user.sub, id);
  }
}
