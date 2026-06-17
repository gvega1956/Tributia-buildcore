import { Controller, Post, Param, Body, Request } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { z } from 'zod';
import type { Request as ExpressRequest } from 'express';
import type { JwtPayload } from '@tributia/core';
import { PERMISSIONS } from '@tributia/core';
import { RequireAuth } from '../iam/decorators/require-auth.decorator.js';
import { RequirePermission } from '../iam/decorators/require-permission.decorator.js';
import { CajaChicaService } from './caja-chica.service.js';
import { ReposicionCajaChicaService } from './reposicion.service.js';
import { ProgramacionPagoService } from './programacion-pago.service.js';

type AuthRequest = ExpressRequest & { user: JwtPayload };

const zCrearFondo = z.object({
  empresaId: z.string().uuid(),
  proyectoId: z.string().uuid(),
  responsableId: z.string().uuid(),
  cuentaBancariaOrigenId: z.string().uuid(),
  montoAsignado: z.string(),
  moneda: z.string().length(3).optional(),
});

const zRegistrarGasto = z.object({
  empresaId: z.string().uuid(),
  proyectoId: z.string().uuid(),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  monto: z.string(),
  moneda: z.string().length(3).optional(),
  concepto: z.string().min(1).max(500),
  numeroComprobante: z.string().min(1).max(50),
  tipoComprobante: z.enum(['FACTURA', 'RECIBO', 'NCF', 'OTRO']),
  proveedorTerceroId: z.string().uuid().optional(),
  partidaId: z.string().uuid().optional(),
});

const zSolicitarReposicion = z.object({
  monto: z.string(),
  moneda: z.string().length(3).optional(),
});

const zProgramarPago = z.object({
  empresaId: z.string().uuid(),
  cuentaPorPagarId: z.string().uuid(),
  cuentaBancariaId: z.string().uuid(),
  monto: z.string(),
  moneda: z.string().length(3).optional(),
  fechaProgramada: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  prioridad: z.number().int().positive().optional(),
  proyectoId: z.string().uuid().optional(),
  centroCostoId: z.string().uuid().optional(),
});

@ApiTags('Tesorería / Caja Chica y Pagos')
@ApiBearerAuth()
@Controller('api/v1/tesoreria')
export class CajaChicaController {
  constructor(
    private readonly cajaChicaSvc: CajaChicaService,
    private readonly reposicionSvc: ReposicionCajaChicaService,
    private readonly programacionSvc: ProgramacionPagoService,
  ) {}

  @Post('fondos-caja-chica')
  @RequireAuth()
  @RequirePermission(PERMISSIONS.CAJA_CHICA_WRITE)
  @ApiOperation({ summary: 'Crea un fondo de caja chica para una obra' })
  crearFondo(@Body() body: unknown, @Request() req: AuthRequest) {
    const input = zCrearFondo.parse(body);
    return this.cajaChicaSvc.crearFondo(req.user.tenantId, req.user.sub, input);
  }

  @Post('fondos-caja-chica/:fondoId/gastos')
  @RequireAuth()
  @RequirePermission(PERMISSIONS.CAJA_CHICA_WRITE)
  @ApiOperation({ summary: 'Registra un gasto documentado contra el fondo de caja chica' })
  registrarGasto(
    @Param('fondoId') fondoId: string,
    @Body() body: unknown,
    @Request() req: AuthRequest,
  ) {
    const input = zRegistrarGasto.parse(body);
    return this.cajaChicaSvc.registrarGasto(req.user.tenantId, req.user.sub, {
      fondoId,
      ...input,
    });
  }

  @Post('fondos-caja-chica/:fondoId/reposiciones')
  @RequireAuth()
  @RequirePermission(PERMISSIONS.REPOSICION_WRITE)
  @ApiOperation({ summary: 'Solicita una reposición de caja chica (inicia flujo de aprobación)' })
  solicitarReposicion(
    @Param('fondoId') fondoId: string,
    @Body() body: unknown,
    @Request() req: AuthRequest,
  ) {
    const input = zSolicitarReposicion.parse(body);
    return this.reposicionSvc.solicitar(req.user.tenantId, req.user.sub, {
      fondoId,
      ...input,
    });
  }

  @Post('reposiciones/:reposicionId/ejecutar')
  @RequireAuth()
  @RequirePermission(PERMISSIONS.REPOSICION_WRITE)
  @ApiOperation({ summary: 'Ejecuta una reposición aprobada (requiere workflow APROBADO)' })
  ejecutarReposicion(
    @Param('reposicionId') reposicionId: string,
    @Request() req: AuthRequest,
  ) {
    return this.reposicionSvc.ejecutar(req.user.tenantId, req.user.sub, reposicionId);
  }

  @Post('programacion-pagos')
  @RequireAuth()
  @RequirePermission(PERMISSIONS.PAGO_PROGRAMADO_WRITE)
  @ApiOperation({ summary: 'Programa un pago a proveedor en la cola de tesorería' })
  programarPago(@Body() body: unknown, @Request() req: AuthRequest) {
    const input = zProgramarPago.parse(body);
    return this.programacionSvc.programar(req.user.tenantId, req.user.sub, input);
  }

  @Post('programacion-pagos/ejecutar-lote')
  @RequireAuth()
  @RequirePermission(PERMISSIONS.PAGO_PROGRAMADO_WRITE)
  @ApiOperation({ summary: 'Ejecuta la cola de pagos de una cuenta bancaria por prioridad' })
  ejecutarLote(
    @Body() body: { cuentaBancariaId: string },
    @Request() req: AuthRequest,
  ) {
    const cuentaBancariaId = z.string().uuid().parse(body.cuentaBancariaId);
    return this.programacionSvc.ejecutarLote(req.user.tenantId, req.user.sub, cuentaBancariaId);
  }
}
