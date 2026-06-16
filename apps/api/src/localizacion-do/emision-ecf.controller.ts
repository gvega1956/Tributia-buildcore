import { Controller, Get, Post, Param, Body, Request, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import type { Request as ExpressRequest } from 'express';
import type { JwtPayload } from '@tributia/core';
import { PERMISSIONS } from '@tributia/core';
import { RequireAuth } from '../iam/decorators/require-auth.decorator.js';
import { RequirePermission } from '../iam/decorators/require-permission.decorator.js';
import { EmisionEcfService, zEmisionEcfDto } from './emision-ecf.service.js';
import {
  ConfiguracionEmisorEcfService,
  zConfiguracionEmisorDto,
  zInicializarSecuenciaDto,
} from './configuracion-emisor-ecf.service.js';

type AuthRequest = ExpressRequest & { user: JwtPayload };

@ApiTags('Localización DO / e-CF')
@ApiBearerAuth()
@Controller('api/v1/localizacion-do/ecf')
export class EmisionEcfController {
  constructor(private readonly svc: EmisionEcfService) {}

  @Get()
  @RequireAuth()
  @RequirePermission(PERMISSIONS.ECF_EMISION_READ)
  @ApiOperation({ summary: 'Lista e-CF emitidos' })
  @ApiQuery({ name: 'facturaClienteId', required: false })
  listar(@Request() req: AuthRequest, @Query('facturaClienteId') facturaClienteId?: string) {
    return this.svc.findAll(req.user.tenantId, facturaClienteId);
  }

  @Get(':id')
  @RequireAuth()
  @RequirePermission(PERMISSIONS.ECF_EMISION_READ)
  @ApiOperation({ summary: 'Detalle de un e-CF emitido, con su acuse si existe' })
  findOne(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.svc.findById(req.user.tenantId, id);
  }

  @Post()
  @RequireAuth()
  @RequirePermission(PERMISSIONS.ECF_EMISION_WRITE)
  @ApiOperation({
    summary:
      'Emite un e-CF de venta (31/32 desde una factura de cliente, 33/34 referenciando su e-CF de origen) ' +
      'a través del middleware de la empresa emisora — maneja contingencia (RI) automáticamente',
  })
  emitir(@Body() body: unknown, @Request() req: AuthRequest) {
    const dto = zEmisionEcfDto.parse(body);
    return this.svc.emitir(req.user.tenantId, dto, req.user.sub);
  }
}

@ApiTags('Localización DO / e-CF')
@ApiBearerAuth()
@Controller('api/v1/localizacion-do/emisor')
export class ConfiguracionEmisorEcfController {
  constructor(private readonly svc: ConfiguracionEmisorEcfService) {}

  @Get(':empresaId')
  @RequireAuth()
  @RequirePermission(PERMISSIONS.ECF_EMISION_READ)
  @ApiOperation({ summary: 'Configuración de emisor e-CF de una empresa' })
  findOne(@Param('empresaId') empresaId: string, @Request() req: AuthRequest) {
    return this.svc.findConfiguracion(req.user.tenantId, empresaId);
  }

  @Post()
  @RequireAuth()
  @RequirePermission(PERMISSIONS.ECF_EMISION_WRITE)
  @ApiOperation({
    summary:
      'Da de alta o actualiza la configuración de emisor e-CF de una empresa (RNC, razón social, ' +
      'referencia opaca a su certificado — nunca el certificado en sí)',
  })
  configurar(@Body() body: unknown, @Request() req: AuthRequest) {
    const dto = zConfiguracionEmisorDto.parse(body);
    return this.svc.configurar(req.user.tenantId, dto, req.user.sub);
  }

  @Post('secuencia')
  @RequireAuth()
  @RequirePermission(PERMISSIONS.ECF_EMISION_WRITE)
  @ApiOperation({ summary: 'Inicializa o actualiza el rango de NCF autorizado para un tipo de e-CF' })
  inicializarSecuencia(@Body() body: unknown, @Request() req: AuthRequest) {
    const dto = zInicializarSecuenciaDto.parse(body);
    return this.svc.inicializarSecuencia(req.user.tenantId, dto, req.user.sub);
  }
}
