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
import { ParteDiarioService, zParteDiarioCreateDto } from './parte-diario.service.js';

type AuthRequest = ExpressRequest & { user: JwtPayload };

@ApiTags('Obra / Parte Diario')
@ApiBearerAuth()
@Controller('api/v1/obra/partes')
export class ParteDiarioController {
  constructor(private readonly svc: ParteDiarioService) {}

  @Post()
  @RequireAuth()
  @RequirePermission(PERMISSIONS.PARTE_DIARIO_WRITE)
  @ApiOperation({
    summary: 'Crear parte diario en BORRADOR (idempotente por idempotency_key)',
  })
  crear(@Body() body: unknown, @Request() req: AuthRequest) {
    const dto = zParteDiarioCreateDto.parse(body);
    return this.svc.crear(req.user.tenantId, dto, req.user.sub);
  }

  @Patch(':id/confirmar')
  @RequireAuth()
  @RequirePermission(PERMISSIONS.PARTE_DIARIO_WRITE)
  @ApiOperation({
    summary:
      'Confirmar parte — emite eventos avance_partida, hora_personal, hora_equipo',
  })
  confirmar(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.svc.confirmar(req.user.tenantId, id, req.user.sub);
  }

  @Get()
  @RequireAuth()
  @RequirePermission(PERMISSIONS.AVANCE_WRITE)
  @ApiOperation({ summary: 'Listar partes diarios del tenant (filtrable por proyecto)' })
  findAll(@Query('proyectoId') proyectoId: string | undefined, @Request() req: AuthRequest) {
    return this.svc.findAll(req.user.tenantId, proyectoId);
  }

  @Get(':id')
  @RequireAuth()
  @RequirePermission(PERMISSIONS.AVANCE_WRITE)
  @ApiOperation({ summary: 'Detalle del parte diario con líneas (personal, equipos, avances)' })
  findOne(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.svc.findById(req.user.tenantId, id);
  }
}
