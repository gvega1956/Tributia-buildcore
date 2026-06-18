import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Request,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import type { Request as ExpressRequest } from 'express';
import type { JwtPayload } from '@tributia/core';
import { PERMISSIONS } from '@tributia/core';
import { ApiZodBody } from '../shared/api-zod-body.decorator.js';
import { RequireAuth } from '../iam/decorators/require-auth.decorator.js';
import { RequirePermission } from '../iam/decorators/require-permission.decorator.js';
import { CuentaPorPagarService } from './cuenta-por-pagar.service.js';
import { AnticipoProveedorService, zAnticipoCreate } from './anticipo-proveedor.service.js';
import { ScoringProveedorService } from './scoring-proveedor.service.js';
import { z } from 'zod';

type AuthRequest = ExpressRequest & { user: JwtPayload };

// ─── CuentasPorPagar ─────────────────────────────────────────────────────────

@ApiTags('Compras / Cuentas por Pagar')
@ApiBearerAuth()
@Controller('api/v1/compras/cuentas-por-pagar')
export class CuentaPorPagarController {
  constructor(private readonly svc: CuentaPorPagarService) {}

  @Get()
  @RequireAuth()
  @RequirePermission(PERMISSIONS.CXP_READ)
  @ApiOperation({ summary: 'Lista cuentas por pagar del tenant' })
  @ApiQuery({ name: 'terceroId', required: false })
  listar(@Request() req: AuthRequest, @Query('terceroId') terceroId?: string) {
    return this.svc.listar(req.user.tenantId, terceroId);
  }

  @Get(':id')
  @RequireAuth()
  @RequirePermission(PERMISSIONS.CXP_READ)
  @ApiOperation({ summary: 'Detalle de cuenta por pagar' })
  findOne(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.svc.findById(req.user.tenantId, id);
  }

  @Post(':id/pago')
  @RequireAuth()
  @RequirePermission(PERMISSIONS.OC_APPROVE)
  @ApiOperation({ summary: 'Registrar pago total o parcial de una CxP' })
  registrarPago(
    @Param('id') id: string,
    @Body() body: { monto: string },
    @Request() req: AuthRequest,
  ) {
    const monto = z.string().regex(/^\d+(\.\d{1,4})?$/).parse(body.monto);
    return this.svc.registrarPago(req.user.tenantId, id, monto, req.user.sub);
  }
}

// ─── AnticiposProveedor ──────────────────────────────────────────────────────

@ApiTags('Compras / Anticipos Proveedor')
@ApiBearerAuth()
@Controller('api/v1/compras/anticipos')
export class AnticipoProveedorController {
  constructor(private readonly svc: AnticipoProveedorService) {}

  @Post()
  @RequireAuth()
  @RequirePermission(PERMISSIONS.ANTICIPO_WRITE)
  @ApiOperation({ summary: 'Registrar anticipo a proveedor' })
  @ApiZodBody(zAnticipoCreate)
  registrar(@Body() body: unknown, @Request() req: AuthRequest) {
    const dto = zAnticipoCreate.parse(body);
    return this.svc.registrar(req.user.tenantId, dto, req.user.sub);
  }

  @Post(':id/amortizar')
  @RequireAuth()
  @RequirePermission(PERMISSIONS.ANTICIPO_WRITE)
  @ApiOperation({ summary: 'Amortizar anticipo contra una CxP' })
  amortizar(
    @Param('id') id: string,
    @Body() body: { cxpId: string; monto: string },
    @Request() req: AuthRequest,
  ) {
    return this.svc.amortizar(
      req.user.tenantId,
      id,
      body.cxpId,
      body.monto,
      req.user.sub,
    );
  }
}

// ─── ScoringProveedor ────────────────────────────────────────────────────────

@ApiTags('Compras / Scoring Proveedor')
@ApiBearerAuth()
@Controller('api/v1/compras/scoring')
export class ScoringProveedorController {
  constructor(private readonly svc: ScoringProveedorService) {}

  @Get()
  @RequireAuth()
  @RequirePermission(PERMISSIONS.SCORING_READ)
  @ApiOperation({ summary: 'Lista scorings de todos los proveedores del tenant' })
  listar(@Request() req: AuthRequest) {
    return this.svc.listar(req.user.tenantId);
  }

  @Get(':terceroId')
  @RequireAuth()
  @RequirePermission(PERMISSIONS.SCORING_READ)
  @ApiOperation({ summary: 'Scoring de un proveedor específico' })
  getScoring(@Param('terceroId') terceroId: string, @Request() req: AuthRequest) {
    return this.svc.getScoring(req.user.tenantId, terceroId);
  }
}
