import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { CatalogoDgiiService } from './catalogo-dgii.service.js';
import { RequirePermission } from '../iam/decorators/require-permission.decorator.js';
import { PERMISSIONS } from '@tributia/core';

@ApiTags('catalogo-dgii')
@ApiBearerAuth()
@Controller('api/v1/dgii')
export class CatalogoDgiiController {
  constructor(private readonly service: CatalogoDgiiService) {}

  @Get('tipos-ecf')
  @RequirePermission(PERMISSIONS.CATALOGO_DGII_READ)
  @ApiOperation({ summary: 'Tipos de e-CF (Comprobantes Fiscales Electrónicos) DGII vigentes' })
  @ApiResponse({ status: 200 })
  tiposEcf() {
    return this.service.tiposEcfVigentes();
  }

  @Get('tasas-itbis')
  @RequirePermission(PERMISSIONS.CATALOGO_DGII_READ)
  @ApiOperation({ summary: 'Tasas de ITBIS vigentes según DGII' })
  @ApiResponse({ status: 200 })
  tasasItbis() {
    return this.service.tasasItbisVigentes();
  }

  @Get('tipos-retencion')
  @RequirePermission(PERMISSIONS.CATALOGO_DGII_READ)
  @ApiOperation({ summary: 'Tipos de retención fiscal vigentes según DGII' })
  @ApiResponse({ status: 200 })
  tiposRetencion() {
    return this.service.tiposRetencionVigentes();
  }
}
