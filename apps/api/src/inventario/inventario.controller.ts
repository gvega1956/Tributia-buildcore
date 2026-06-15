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
import type { Request as ExpressRequest } from 'express';
import type { JwtPayload } from '@tributia/core';
import { PERMISSIONS } from '@tributia/core';
import { zConteoFisicoCreate, zLineaConteoCreate } from '@tributia/inventario';
import { RequireAuth } from '../iam/decorators/require-auth.decorator.js';
import { RequirePermission } from '../iam/decorators/require-permission.decorator.js';
import { InventarioService } from './inventario.service.js';

type AuthRequest = ExpressRequest & { user: JwtPayload };

@ApiTags('Inventario')
@ApiBearerAuth()
@Controller('api/v1/inventario')
export class InventarioController {
  constructor(private readonly inventarioService: InventarioService) {}

  // ── Stock ──────────────────────────────────────────────────────────────────

  @Get('almacenes/:almacenId/stock')
  @RequireAuth()
  @RequirePermission(PERMISSIONS.INVENTARIO_READ)
  @ApiOperation({ summary: 'Stock actual del almacén (todos los insumos)' })
  @ApiQuery({ name: 'insumoId', required: false })
  getStock(
    @Param('almacenId') almacenId: string,
    @Request() req: AuthRequest,
    @Query('insumoId') insumoId?: string,
  ) {
    return this.inventarioService.getStock(req.user.tenantId, almacenId, insumoId);
  }

  @Get('almacenes/:almacenId/kardex/:insumoId')
  @RequireAuth()
  @RequirePermission(PERMISSIONS.INVENTARIO_READ)
  @ApiOperation({ summary: 'Kárdex de un insumo en un almacén' })
  getKardex(
    @Param('almacenId') almacenId: string,
    @Param('insumoId') insumoId: string,
    @Request() req: AuthRequest,
  ) {
    return this.inventarioService.getKardex(req.user.tenantId, almacenId, insumoId);
  }

  @Get('movimientos')
  @RequireAuth()
  @RequirePermission(PERMISSIONS.INVENTARIO_READ)
  @ApiOperation({ summary: 'Movimientos de inventario' })
  @ApiQuery({ name: 'almacenId', required: false })
  getMovimientos(@Request() req: AuthRequest, @Query('almacenId') almacenId?: string) {
    return this.inventarioService.getMovimientos(req.user.tenantId, almacenId);
  }

  // ── Conteos físicos ───────────────────────────────────────────────────────

  @Get('conteos')
  @RequireAuth()
  @RequirePermission(PERMISSIONS.INVENTARIO_READ)
  @ApiOperation({ summary: 'Lista conteos físicos' })
  @ApiQuery({ name: 'almacenId', required: false })
  findConteos(@Request() req: AuthRequest, @Query('almacenId') almacenId?: string) {
    return this.inventarioService.findConteos(req.user.tenantId, almacenId);
  }

  @Post('conteos')
  @RequireAuth()
  @RequirePermission(PERMISSIONS.AJUSTE_INVENTARIO)
  @ApiOperation({ summary: 'Iniciar conteo físico' })
  createConteo(@Body() body: unknown, @Request() req: AuthRequest) {
    const input = zConteoFisicoCreate.parse(body);
    return this.inventarioService.createConteo(req.user.tenantId, req.user.sub, input);
  }

  @Post('conteos/:conteoId/lineas')
  @RequireAuth()
  @RequirePermission(PERMISSIONS.AJUSTE_INVENTARIO)
  @ApiOperation({ summary: 'Agregar línea a conteo físico' })
  addLinea(
    @Param('conteoId') conteoId: string,
    @Body() body: unknown,
    @Request() req: AuthRequest,
  ) {
    const input = zLineaConteoCreate.parse(body);
    return this.inventarioService.addLineaConteo(req.user.tenantId, req.user.sub, conteoId, input);
  }

  @Post('conteos/:conteoId/finalizar')
  @RequireAuth()
  @RequirePermission(PERMISSIONS.AJUSTE_INVENTARIO)
  @ApiOperation({ summary: 'Finalizar conteo físico y generar ajustes de inventario' })
  finalizarConteo(
    @Param('conteoId') conteoId: string,
    @Body() body: { empresaId: string; proyectoId?: string; centroCostoId?: string },
    @Request() req: AuthRequest,
  ) {
    return this.inventarioService.finalizarConteo(req.user.tenantId, req.user.sub, conteoId, body);
  }

  // ── Herramientas ──────────────────────────────────────────────────────────

  @Post('herramientas/asignar')
  @RequireAuth()
  @RequirePermission(PERMISSIONS.INVENTARIO_WRITE)
  @ApiOperation({ summary: 'Asignar herramienta a usuario/proyecto' })
  asignar(
    @Body() body: { insumoId: string; proyectoId?: string; asignadoA: string; fechaAsignacion: string },
    @Request() req: AuthRequest,
  ) {
    return this.inventarioService.asignarHerramienta(req.user.tenantId, req.user.sub, body);
  }

  @Patch('herramientas/:id/devolver')
  @RequireAuth()
  @RequirePermission(PERMISSIONS.INVENTARIO_WRITE)
  @ApiOperation({ summary: 'Registrar devolución de herramienta' })
  devolver(
    @Param('id') id: string,
    @Body() body: { fechaDevolucion: string },
    @Request() req: AuthRequest,
  ) {
    return this.inventarioService.devolverHerramienta(
      req.user.tenantId,
      req.user.sub,
      id,
      body.fechaDevolucion,
    );
  }
}
