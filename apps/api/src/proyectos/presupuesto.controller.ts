import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  HttpCode,
  Request,
  BadRequestException,
  UploadedFile,
  UseInterceptors,
  Query,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiConsumes,
  ApiBody,
  ApiQuery,
} from '@nestjs/swagger';
import { ApiZodBody } from '../shared/api-zod-body.decorator.js';
import type { Request as ExpressRequest } from 'express';
import type { JwtPayload } from '@tributia/core';
import { PERMISSIONS } from '@tributia/core';
import {
  zVersionPresupuestoCreate,
  zLineaPresupuestoCreate,
  zLineaPresupuestoUpdate,
  zAprobarPresupuesto,
  zImportarPresupuestoInput,
} from '@tributia/proyectos';
import { RequireAuth } from '../iam/decorators/require-auth.decorator.js';
import { RequirePermission } from '../iam/decorators/require-permission.decorator.js';
import { PresupuestoService } from './presupuesto.service.js';
import { PresupuestoImporter } from '../importadores/presupuesto.importer.js';

type AuthRequest = ExpressRequest & { user: JwtPayload };

@ApiTags('Presupuesto')
@ApiBearerAuth()
@Controller('api/v1/proyectos/:proyectoId/presupuesto')
export class PresupuestoController {
  constructor(
    private readonly presupuestoService: PresupuestoService,
    private readonly presupuestoImporter: PresupuestoImporter,
  ) {}

  // ── Versiones ──────────────────────────────────────────────────────────────

  @Get()
  @RequireAuth()
  @ApiOperation({ summary: 'Listar versiones de presupuesto del proyecto' })
  findVersiones(
    @Param('proyectoId') proyectoId: string,
    @Request() req: AuthRequest,
  ) {
    const { tenantId, sub: usuarioId, empresaId } = req.user;
    return this.presupuestoService.findVersiones(tenantId, proyectoId, empresaId, usuarioId);
  }

  @Get('vigente')
  @RequireAuth()
  @ApiOperation({
    summary: 'Obtener presupuesto vigente del proyecto',
    description: 'El vigente es el BASE aprobado. Sin órdenes de cambio, vigente = base.',
  })
  @ApiResponse({ status: 200, description: 'Versión BASE aprobada con sus líneas' })
  @ApiResponse({ status: 404, description: 'No existe presupuesto base aprobado' })
  getVigente(
    @Param('proyectoId') proyectoId: string,
    @Request() req: AuthRequest,
  ) {
    const { tenantId, sub: usuarioId, empresaId } = req.user;
    return this.presupuestoService.findPresupuestoVigente(
      tenantId, proyectoId, empresaId, usuarioId,
    );
  }

  @Get(':versionId')
  @RequireAuth()
  @ApiOperation({ summary: 'Obtener versión de presupuesto por ID (con líneas)' })
  findVersion(
    @Param('proyectoId') proyectoId: string,
    @Param('versionId') versionId: string,
    @Request() req: AuthRequest,
  ) {
    const { tenantId, sub: usuarioId, empresaId } = req.user;
    return this.presupuestoService.findVersionById(
      tenantId, proyectoId, empresaId, usuarioId, versionId,
    );
  }

  @Post()
  @RequirePermission(PERMISSIONS.PRESUPUESTO_WRITE)
  @ApiOperation({
    summary: 'Crear nueva versión de presupuesto',
    description: 'Con snapshotPartidas=true crea una línea por cada partida activa del proyecto.',
  })
  @ApiZodBody(zVersionPresupuestoCreate)
  @ApiResponse({ status: 201, description: 'Versión creada' })
  createVersion(
    @Param('proyectoId') proyectoId: string,
    @Body() body: unknown,
    @Request() req: AuthRequest,
  ) {
    const input = zVersionPresupuestoCreate.parse(body);
    const { tenantId, sub: usuarioId, empresaId } = req.user;
    return this.presupuestoService.createVersion(
      tenantId, proyectoId, empresaId, usuarioId, input,
    );
  }

  // ── Aprobación / Rechazo ──────────────────────────────────────────────────

  @Post(':versionId/aprobar')
  @RequirePermission(PERMISSIONS.PRESUPUESTO_APPROVE)
  @ApiOperation({
    summary: 'Aprobar versión como BASE',
    description:
      'Solo una versión BASE puede estar aprobada por proyecto. ' +
      'Una vez aprobada sus líneas son inmutables (protegido por trigger DB).',
  })
  @ApiResponse({ status: 201, description: 'Versión aprobada' })
  @ApiZodBody(zAprobarPresupuesto)
  @ApiResponse({ status: 409, description: 'Ya existe un BASE aprobado para este proyecto' })
  @ApiResponse({ status: 422, description: 'La versión no está en estado PENDIENTE' })
  aprobar(
    @Param('proyectoId') proyectoId: string,
    @Param('versionId') versionId: string,
    @Body() body: unknown,
    @Request() req: AuthRequest,
  ) {
    const input = zAprobarPresupuesto.parse(body);
    const { tenantId, sub: usuarioId, empresaId } = req.user;
    return this.presupuestoService.aprobar(
      tenantId, proyectoId, empresaId, usuarioId, versionId, input,
    );
  }

  @Post(':versionId/rechazar')
  @RequirePermission(PERMISSIONS.PRESUPUESTO_APPROVE)
  @ApiOperation({ summary: 'Rechazar versión de presupuesto' })
  rechazar(
    @Param('proyectoId') proyectoId: string,
    @Param('versionId') versionId: string,
    @Body() body: { notas?: string },
    @Request() req: AuthRequest,
  ) {
    const { tenantId, sub: usuarioId, empresaId } = req.user;
    return this.presupuestoService.rechazar(
      tenantId, proyectoId, empresaId, usuarioId, versionId, body.notas,
    );
  }

  // ── Líneas ─────────────────────────────────────────────────────────────────

  @Post(':versionId/lineas')
  @RequirePermission(PERMISSIONS.PRESUPUESTO_WRITE)
  @ApiOperation({ summary: 'Añadir línea a versión de presupuesto (solo BORRADOR)' })
  @ApiZodBody(zLineaPresupuestoCreate)
  @ApiResponse({ status: 201, description: 'Línea añadida; totales recalculados' })
  @ApiResponse({ status: 409, description: 'Ya existe una línea para esa partida' })
  @ApiResponse({ status: 422, description: 'El presupuesto no está en estado PENDIENTE' })
  addLinea(
    @Param('proyectoId') proyectoId: string,
    @Param('versionId') versionId: string,
    @Body() body: unknown,
    @Request() req: AuthRequest,
  ) {
    const input = zLineaPresupuestoCreate.parse(body);
    const { tenantId, sub: usuarioId, empresaId } = req.user;
    return this.presupuestoService.addLinea(
      tenantId, proyectoId, empresaId, usuarioId, versionId, input,
    );
  }

  @Patch(':versionId/lineas/:lineaId')
  @RequirePermission(PERMISSIONS.PRESUPUESTO_WRITE)
  @ApiOperation({ summary: 'Actualizar línea de presupuesto (solo versión PENDIENTE)' })
  @ApiZodBody(zLineaPresupuestoUpdate)
  @ApiResponse({ status: 422, description: 'El presupuesto está aprobado — inmutable' })
  updateLinea(
    @Param('proyectoId') proyectoId: string,
    @Param('versionId') versionId: string,
    @Param('lineaId') lineaId: string,
    @Body() body: unknown,
    @Request() req: AuthRequest,
  ) {
    const input = zLineaPresupuestoUpdate.parse(body);
    const { tenantId, sub: usuarioId, empresaId } = req.user;
    return this.presupuestoService.updateLinea(
      tenantId, proyectoId, empresaId, usuarioId, versionId, lineaId, input,
    );
  }

  @Delete(':versionId/lineas/:lineaId')
  @HttpCode(204)
  @RequirePermission(PERMISSIONS.PRESUPUESTO_WRITE)
  @ApiOperation({ summary: 'Eliminar línea de presupuesto (solo versión PENDIENTE)' })
  @ApiResponse({ status: 204, description: 'Línea eliminada' })
  @ApiResponse({ status: 422, description: 'El presupuesto está aprobado — inmutable' })
  async deleteLinea(
    @Param('proyectoId') proyectoId: string,
    @Param('versionId') versionId: string,
    @Param('lineaId') lineaId: string,
    @Request() req: AuthRequest,
  ) {
    const { tenantId, sub: usuarioId, empresaId } = req.user;
    await this.presupuestoService.removeLinea(
      tenantId, proyectoId, empresaId, usuarioId, versionId, lineaId,
    );
  }

  // ── Importador Excel ───────────────────────────────────────────────────────

  @Post('importar')
  @RequirePermission(PERMISSIONS.PRESUPUESTO_WRITE)
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description:
      'Excel con columnas de presupuesto. El mapeo de columnas es configurable (parámetro mapeo en el body o query).',
  })
  @ApiOperation({
    summary: 'Importar presupuesto desde Excel',
    description:
      'Crea una versión BORRADOR con las líneas del Excel. ' +
      'Configura el mapeo de columnas (A, B, C...) para adaptar a cualquier formato de constructora. ' +
      'Con simulacion=true valida sin persistir.',
  })
  @ApiQuery({ name: 'simulacion', required: false, type: Boolean })
  async importar(
    @Param('proyectoId') proyectoId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Query('simulacion') simulacionStr: string | undefined,
    @Body() body: unknown,
    @Request() req: AuthRequest,
  ) {
    if (!file) throw new BadRequestException('Se requiere el campo "file" con el Excel.');
    const ext = file.originalname.toLowerCase();
    if (!ext.endsWith('.xlsx') && !ext.endsWith('.xls')) {
      throw new BadRequestException('Solo se aceptan archivos Excel (.xlsx o .xls).');
    }

    const rawBody = body && typeof body === 'object' ? body : {};
    const simulacion =
      simulacionStr === 'true' || simulacionStr === '1' ||
      ('simulacion' in rawBody && (rawBody as Record<string, unknown>)['simulacion'] === true);

    const input = zImportarPresupuestoInput.parse({ ...rawBody, simulacion });
    const { tenantId, sub: usuarioId, empresaId } = req.user;
    return this.presupuestoImporter.importarPresupuesto(
      file.buffer,
      { tenantId, usuarioId, empresaId, proyectoId },
      input,
    );
  }
}
