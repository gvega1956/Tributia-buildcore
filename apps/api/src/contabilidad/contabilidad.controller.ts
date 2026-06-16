import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  Request,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { z } from 'zod';
import type { Request as ExpressRequest } from 'express';
import type { JwtPayload } from '@tributia/core';
import { PERMISSIONS } from '@tributia/core';
import { zBusinessDate } from '@tributia/shared';
import { RequireAuth } from '../iam/decorators/require-auth.decorator.js';
import { RequirePermission } from '../iam/decorators/require-permission.decorator.js';
import { LibroContableService } from './libro-contable.service.js';
import { EstadosFinancierosService } from './estados-financieros.service.js';
import { AsientoContableService } from './asiento-contable.service.js';
import { DbService } from '../database/db.service.js';

type AuthRequest = ExpressRequest & { user: JwtPayload };

// ─── DTO ajuste manual ────────────────────────────────────────────────────────

const zLineaAjuste = z.object({
  cuentaCodigo: z.string().min(1).max(20),
  tipo: z.enum(['debe', 'haber']),
  importe: z.string().regex(/^\d+(\.\d{1,4})?$/, 'Importe debe ser decimal positivo'),
  moneda: z.enum(['DOP', 'USD', 'EUR']).default('DOP'),
  descripcion: z.string().max(300).optional(),
});

const zAsientoAjusteCreate = z.object({
  empresaId: z.string().uuid('empresaId debe ser UUID'),
  fecha: zBusinessDate,
  descripcion: z.string().min(5).max(500),
  lineas: z.array(zLineaAjuste).min(2, 'El asiento requiere al menos 2 líneas'),
});

// ─── Controller ───────────────────────────────────────────────────────────────

@ApiTags('Contabilidad')
@ApiBearerAuth()
@Controller('api/v1/contabilidad')
export class ContabilidadController {
  constructor(
    private readonly libroSvc: LibroContableService,
    private readonly estadosSvc: EstadosFinancierosService,
    private readonly asientoSvc: AsientoContableService,
    private readonly dbService: DbService,
  ) {}

  // ── Libro Diario ─────────────────────────────────────────────────────────────

  @Get('libro-diario')
  @RequireAuth()
  @RequirePermission(PERMISSIONS.ASIENTO_READ)
  @ApiOperation({ summary: 'Libro Diario del período con trazabilidad a evento origen' })
  @ApiQuery({ name: 'fechaDesde', required: true })
  @ApiQuery({ name: 'fechaHasta', required: true })
  @ApiQuery({ name: 'cuentaId', required: false })
  @ApiQuery({ name: 'proyectoId', required: false })
  libroDiario(
    @Request() req: AuthRequest,
    @Query('fechaDesde') fechaDesde: string,
    @Query('fechaHasta') fechaHasta: string,
    @Query('cuentaId') cuentaId?: string,
    @Query('proyectoId') proyectoId?: string,
  ) {
    this.validarRango(fechaDesde, fechaHasta);
    return this.libroSvc.libroDiario(req.user.empresaId, {
      fechaDesde, fechaHasta,
      ...(cuentaId   !== undefined && { cuentaId }),
      ...(proyectoId !== undefined && { proyectoId }),
    });
  }

  // ── Libro Mayor ───────────────────────────────────────────────────────────────

  @Get('libro-mayor/:cuentaId')
  @RequireAuth()
  @RequirePermission(PERMISSIONS.ASIENTO_READ)
  @ApiOperation({ summary: 'Libro Mayor de una cuenta con saldo corredor' })
  @ApiQuery({ name: 'fechaDesde', required: true })
  @ApiQuery({ name: 'fechaHasta', required: true })
  libroMayor(
    @Request() req: AuthRequest,
    @Param('cuentaId') cuentaId: string,
    @Query('fechaDesde') fechaDesde: string,
    @Query('fechaHasta') fechaHasta: string,
  ) {
    this.validarRango(fechaDesde, fechaHasta);
    return this.libroSvc.libroMayor(req.user.empresaId, cuentaId, { fechaDesde, fechaHasta });
  }

  // ── Balanza de Comprobación ──────────────────────────────────────────────────

  @Get('balanza')
  @RequireAuth()
  @RequirePermission(PERMISSIONS.ASIENTO_READ)
  @ApiOperation({ summary: 'Balanza de comprobación: Σdebe = Σhaber por cuenta' })
  @ApiQuery({ name: 'fechaDesde', required: true })
  @ApiQuery({ name: 'fechaHasta', required: true })
  balanza(
    @Request() req: AuthRequest,
    @Query('fechaDesde') fechaDesde: string,
    @Query('fechaHasta') fechaHasta: string,
  ) {
    this.validarRango(fechaDesde, fechaHasta);
    return this.libroSvc.balanza(req.user.empresaId, { fechaDesde, fechaHasta });
  }

  // ── Detalle asiento con trazabilidad P8 ──────────────────────────────────────

  @Get('asientos/:id')
  @RequireAuth()
  @RequirePermission(PERMISSIONS.ASIENTO_READ)
  @ApiOperation({ summary: 'Detalle de un asiento con enlace al evento operativo origen (P8)' })
  detalleAsiento(@Request() req: AuthRequest, @Param('id') id: string) {
    return this.libroSvc.detalleAsiento(req.user.empresaId, id);
  }

  // ── Balance General ───────────────────────────────────────────────────────────

  @Get('balance-general')
  @RequireAuth()
  @RequirePermission(PERMISSIONS.REPORTE_FINANCIERO)
  @ApiOperation({ summary: 'Balance General al corte de una fecha: Activo = Pasivo + Patrimonio' })
  @ApiQuery({ name: 'fechaCorte', required: true })
  balanceGeneral(
    @Request() req: AuthRequest,
    @Query('fechaCorte') fechaCorte: string,
  ) {
    if (!fechaCorte) throw new BadRequestException('fechaCorte es requerido (YYYY-MM-DD)');
    return this.estadosSvc.balanceGeneral(req.user.empresaId, fechaCorte);
  }

  // ── Estado de Resultados ─────────────────────────────────────────────────────

  @Get('estado-resultados')
  @RequireAuth()
  @RequirePermission(PERMISSIONS.REPORTE_FINANCIERO)
  @ApiOperation({ summary: 'Estado de Resultados del período, con desglose por proyecto' })
  @ApiQuery({ name: 'fechaDesde', required: true })
  @ApiQuery({ name: 'fechaHasta', required: true })
  @ApiQuery({ name: 'proyectoId', required: false })
  estadoResultados(
    @Request() req: AuthRequest,
    @Query('fechaDesde') fechaDesde: string,
    @Query('fechaHasta') fechaHasta: string,
    @Query('proyectoId') proyectoId?: string,
  ) {
    this.validarRango(fechaDesde, fechaHasta);
    return this.estadosSvc.estadoResultados(req.user.empresaId, {
      fechaDesde, fechaHasta,
      ...(proyectoId !== undefined && { proyectoId }),
    });
  }

  // ── Asiento manual de ajuste ─────────────────────────────────────────────────

  @Post('asientos/ajuste')
  @RequireAuth()
  @RequirePermission(PERMISSIONS.ASIENTO_MANUAL)
  @ApiOperation({
    summary: 'Registrar asiento manual de ajuste (contabilidad:manual). Nunca puede ser tipo operativo.',
  })
  async registrarAjuste(@Body() body: unknown, @Request() req: AuthRequest) {
    const input = zAsientoAjusteCreate.parse(body);

    // Tipo hardcodeado a 'ajuste' — el usuario nunca puede enviar tipo='automatico'.
    // La validación es doble: DTO no tiene campo tipo, y registrarAjuste() fuerza tipo='ajuste'.
    return this.dbService.tx.transaction(async (tx) => {
      return this.asientoSvc.registrarAjuste(
        {
          tenantId:    req.user.tenantId,
          empresaId:   input.empresaId,
          fecha:       input.fecha,
          descripcion: input.descripcion,
          lineas:      input.lineas.map((l) => ({
            cuentaCodigo: l.cuentaCodigo,
            tipo:         l.tipo,
            importe:      l.importe,
            moneda:       l.moneda ?? 'DOP',
            ...(l.descripcion !== undefined && { descripcion: l.descripcion }),
          })),
          usuarioId: req.user.sub,
        },
        tx,
      );
    });
  }

  // ─── helpers ─────────────────────────────────────────────────────────────────

  private validarRango(desde: string, hasta: string): void {
    if (!desde || !hasta) throw new BadRequestException('fechaDesde y fechaHasta son requeridos (YYYY-MM-DD)');
    if (desde > hasta) throw new BadRequestException('fechaDesde no puede ser posterior a fechaHasta');
  }
}
