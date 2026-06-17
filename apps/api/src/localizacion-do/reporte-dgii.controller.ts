import { Controller, Get, Param, Query, Request, Res } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import type { Response as ExpressResponse } from 'express';
import type { Request as ExpressRequest } from 'express';
import type { JwtPayload } from '@tributia/core';
import { PERMISSIONS } from '@tributia/core';
import { RequireAuth } from '../iam/decorators/require-auth.decorator.js';
import { RequirePermission } from '../iam/decorators/require-permission.decorator.js';
import { ReporteDgiiService } from './reporte-dgii.service.js';

type AuthRequest = ExpressRequest & { user: JwtPayload };

function parsePeriodo(anioStr: string | undefined, mesStr: string | undefined): { anio: number; mes: number } {
  return {
    anio: anioStr ? parseInt(anioStr, 10) : new Date().getFullYear(),
    mes: mesStr ? parseInt(mesStr, 10) : new Date().getMonth() + 1,
  };
}

@ApiTags('Fiscal / Reportes DGII')
@ApiBearerAuth()
@Controller('api/v1/fiscal/:empresaId')
export class ReporteDgiiController {
  constructor(private readonly svc: ReporteDgiiService) {}

  @Get('606')
  @RequireAuth()
  @RequirePermission(PERMISSIONS.REPORTE_DGII_READ)
  @ApiOperation({ summary: 'Reporte 606 — Compras del período (facturas de proveedor)' })
  @ApiQuery({ name: 'anio', required: false })
  @ApiQuery({ name: 'mes', required: false })
  @ApiQuery({ name: 'formato', required: false, description: 'json (default) | txt' })
  async reporte606(
    @Param('empresaId') empresaId: string,
    @Query('anio') anioStr: string | undefined,
    @Query('mes') mesStr: string | undefined,
    @Query('formato') formato: string | undefined,
    @Request() req: AuthRequest,
    @Res({ passthrough: true }) res: ExpressResponse,
  ) {
    const { anio, mes } = parsePeriodo(anioStr, mesStr);
    const reporte = await this.svc.generar606(req.user.tenantId, empresaId, anio, mes);
    if (formato === 'txt') {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="606-${anio}${String(mes).padStart(2,'0')}.txt"`);
      return this.svc.exportar606Txt(reporte);
    }
    return reporte;
  }

  @Get('607')
  @RequireAuth()
  @RequirePermission(PERMISSIONS.REPORTE_DGII_READ)
  @ApiOperation({ summary: 'Reporte 607 — Ventas del período (e-CF emitidos y aceptados)' })
  @ApiQuery({ name: 'anio', required: false })
  @ApiQuery({ name: 'mes', required: false })
  @ApiQuery({ name: 'formato', required: false, description: 'json (default) | txt' })
  async reporte607(
    @Param('empresaId') empresaId: string,
    @Query('anio') anioStr: string | undefined,
    @Query('mes') mesStr: string | undefined,
    @Query('formato') formato: string | undefined,
    @Request() req: AuthRequest,
    @Res({ passthrough: true }) res: ExpressResponse,
  ) {
    const { anio, mes } = parsePeriodo(anioStr, mesStr);
    const reporte = await this.svc.generar607(req.user.tenantId, empresaId, anio, mes);
    if (formato === 'txt') {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="607-${anio}${String(mes).padStart(2,'0')}.txt"`);
      return this.svc.exportar607Txt(reporte);
    }
    return reporte;
  }

  @Get('608')
  @RequireAuth()
  @RequirePermission(PERMISSIONS.REPORTE_DGII_READ)
  @ApiOperation({ summary: 'Reporte 608 — Comprobantes anulados / rechazados del período' })
  @ApiQuery({ name: 'anio', required: false })
  @ApiQuery({ name: 'mes', required: false })
  @ApiQuery({ name: 'formato', required: false })
  async reporte608(
    @Param('empresaId') empresaId: string,
    @Query('anio') anioStr: string | undefined,
    @Query('mes') mesStr: string | undefined,
    @Query('formato') formato: string | undefined,
    @Request() req: AuthRequest,
    @Res({ passthrough: true }) res: ExpressResponse,
  ) {
    const { anio, mes } = parsePeriodo(anioStr, mesStr);
    const reporte = await this.svc.generar608(req.user.tenantId, empresaId, anio, mes);
    if (formato === 'txt') {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="608-${anio}${String(mes).padStart(2,'0')}.txt"`);
      return this.svc.exportar608Txt(reporte);
    }
    return reporte;
  }

  @Get('623')
  @RequireAuth()
  @RequirePermission(PERMISSIONS.REPORTE_DGII_READ)
  @ApiOperation({ summary: 'Reporte 623 — Retenciones practicadas por el Estado a nuestros e-CF' })
  @ApiQuery({ name: 'anio', required: false })
  @ApiQuery({ name: 'mes', required: false })
  @ApiQuery({ name: 'formato', required: false })
  async reporte623(
    @Param('empresaId') empresaId: string,
    @Query('anio') anioStr: string | undefined,
    @Query('mes') mesStr: string | undefined,
    @Query('formato') formato: string | undefined,
    @Request() req: AuthRequest,
    @Res({ passthrough: true }) res: ExpressResponse,
  ) {
    const { anio, mes } = parsePeriodo(anioStr, mesStr);
    const reporte = await this.svc.generar623(req.user.tenantId, empresaId, anio, mes);
    if (formato === 'txt') {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="623-${anio}${String(mes).padStart(2,'0')}.txt"`);
      return this.svc.exportar623Txt(reporte);
    }
    return reporte;
  }

  @Get('it1')
  @RequireAuth()
  @RequirePermission(PERMISSIONS.REPORTE_DGII_READ)
  @ApiOperation({ summary: 'IT-1 — Declaración mensual de ITBIS con reconciliación contable' })
  @ApiQuery({ name: 'anio', required: false })
  @ApiQuery({ name: 'mes', required: false })
  async reporteIT1(
    @Param('empresaId') empresaId: string,
    @Query('anio') anioStr: string | undefined,
    @Query('mes') mesStr: string | undefined,
    @Request() req: AuthRequest,
  ) {
    const { anio, mes } = parsePeriodo(anioStr, mesStr);
    return this.svc.generarIT1(req.user.tenantId, empresaId, anio, mes);
  }
}
