import { Controller, Get, Post, Param, Body, Request, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ApiZodBody } from '../shared/api-zod-body.decorator.js';
import { z } from 'zod';
import type { Request as ExpressRequest } from 'express';
import type { JwtPayload } from '@tributia/core';
import { PERMISSIONS } from '@tributia/core';
import { RequireAuth } from '../iam/decorators/require-auth.decorator.js';
import { RequirePermission } from '../iam/decorators/require-permission.decorator.js';
import { BancoService } from './banco.service.js';
import { CobroService } from './cobro.service.js';

type AuthRequest = ExpressRequest & { user: JwtPayload };

const zCrearCuenta = z.object({
  empresaId: z.string().uuid(),
  bancoNombre: z.string().min(1).max(200),
  numeroCuenta: z.string().min(1).max(50),
  tipoCuenta: z.enum(['CORRIENTE', 'AHORROS']).optional(),
  moneda: z.string().length(3).optional(),
  cuentaContableCodigo: z.string().min(1).max(20),
});

const zRegistrarCobro = z.object({
  empresaId: z.string().uuid(),
  proyectoId: z.string().uuid().optional(),
  centroCostoId: z.string().uuid().optional(),
  cuentaBancariaId: z.string().uuid(),
  facturaClienteId: z.string().uuid().optional(),
  montoCobrado: z.object({ amount: z.string(), currency: z.string() }),
  tasaFactura: z.string(),
  tasaCobro: z.string(),
  monedaBase: z.enum(['DOP', 'USD', 'EUR']),
  aplicaciones: z.array(z.object({
    cuentaPorCobrarId: z.string().uuid(),
    monto: z.object({ amount: z.string(), currency: z.string() }),
  })).optional(),
  referenciaBancaria: z.string().max(100).optional(),
});

@ApiTags('Tesorería / Bancos')
@ApiBearerAuth()
@Controller('api/v1/tesoreria')
export class BancoController {
  constructor(
    private readonly bancoSvc: BancoService,
    private readonly cobroSvc: CobroService,
  ) {}

  @Post('cuentas-bancarias')
  @RequireAuth()
  @RequirePermission(PERMISSIONS.BANCO_WRITE)
  @ApiOperation({ summary: 'Registra una nueva cuenta bancaria' })
  @ApiZodBody(zCrearCuenta)
  crearCuenta(@Body() body: unknown, @Request() req: AuthRequest) {
    const input = zCrearCuenta.parse(body);
    return this.bancoSvc.crearCuenta(req.user.tenantId, req.user.sub, input);
  }

  @Get('cuentas-bancarias')
  @RequireAuth()
  @RequirePermission(PERMISSIONS.BANCO_READ)
  @ApiOperation({ summary: 'Lista cuentas bancarias del tenant' })
  listarCuentas(@Request() req: AuthRequest, @Query('empresaId') empresaId?: string) {
    return this.bancoSvc.listarCuentas(req.user.tenantId, empresaId);
  }

  @Get('cuentas-bancarias/:id')
  @RequireAuth()
  @RequirePermission(PERMISSIONS.BANCO_READ)
  @ApiOperation({ summary: 'Detalle de cuenta bancaria' })
  findOne(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.bancoSvc.findCuentaById(req.user.tenantId, id);
  }

  @Get('cuentas-bancarias/:id/movimientos')
  @RequireAuth()
  @RequirePermission(PERMISSIONS.BANCO_READ)
  @ApiOperation({ summary: 'Movimientos de una cuenta bancaria' })
  listarMovimientos(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.bancoSvc.listarMovimientos(req.user.tenantId, id);
  }

  @Post('cobros')
  @RequireAuth()
  @RequirePermission(PERMISSIONS.COBRO_WRITE)
  @ApiOperation({ summary: 'Registra un cobro recibido y emite evento al ledger' })
  @ApiZodBody(zRegistrarCobro)
  registrarCobro(@Body() body: unknown, @Request() req: AuthRequest) {
    const input = zRegistrarCobro.parse(body);
    return this.cobroSvc.registrarCobro(req.user.tenantId, req.user.sub, input as Parameters<CobroService['registrarCobro']>[2]);
  }
}
