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
import type { Request as ExpressRequest } from 'express';
import type { JwtPayload } from '@tributia/core';
import { PERMISSIONS } from '@tributia/core';
import {
  zPartidaCreate,
  zPartidaUpdate,
  zReordenarPartida,
} from '@tributia/proyectos';
import { RequireAuth } from '../iam/decorators/require-auth.decorator.js';
import { RequirePermission } from '../iam/decorators/require-permission.decorator.js';
import { PartidaService } from './partida.service.js';
import { PartidaImporter } from '../importadores/partida.importer.js';

type AuthRequest = ExpressRequest & { user: JwtPayload };

@ApiTags('EDT / Partidas')
@ApiBearerAuth()
@Controller('api/v1/proyectos/:proyectoId/edt')
export class PartidaController {
  constructor(
    private readonly partidaService: PartidaService,
    private readonly partidaImporter: PartidaImporter,
  ) {}

  // ── GET /proyectos/:proyectoId/edt ────────────────────────────────────────

  @Get()
  @RequireAuth()
  @ApiOperation({ summary: 'Árbol EDT completo del proyecto' })
  @ApiResponse({ status: 200, description: 'Lista jerárquica de partidas activas' })
  findTree(
    @Param('proyectoId') proyectoId: string,
    @Request() req: AuthRequest,
  ) {
    const { tenantId, sub: usuarioId, empresaId } = req.user;
    return this.partidaService.findTree(tenantId, proyectoId, empresaId, usuarioId);
  }

  // ── GET /proyectos/:proyectoId/edt/:id ────────────────────────────────────

  @Get(':id')
  @RequireAuth()
  @ApiOperation({ summary: 'Obtener partida por ID' })
  findOne(
    @Param('proyectoId') proyectoId: string,
    @Param('id') id: string,
    @Request() req: AuthRequest,
  ) {
    const { tenantId, sub: usuarioId, empresaId } = req.user;
    return this.partidaService.findById(tenantId, proyectoId, empresaId, usuarioId, id);
  }

  // ── POST /proyectos/:proyectoId/edt ───────────────────────────────────────

  @Post()
  @RequirePermission(PERMISSIONS.EDT_WRITE)
  @ApiOperation({ summary: 'Crear capítulo, partida o sub-partida' })
  @ApiResponse({ status: 201, description: 'Partida creada' })
  @ApiResponse({ status: 409, description: 'Código duplicado en el proyecto' })
  @ApiResponse({ status: 422, description: 'Nivel máximo excedido o datos inválidos' })
  create(
    @Param('proyectoId') proyectoId: string,
    @Body() body: unknown,
    @Request() req: AuthRequest,
  ) {
    const input = zPartidaCreate.parse(body);
    const { tenantId, sub: usuarioId, empresaId } = req.user;
    return this.partidaService.create(tenantId, proyectoId, empresaId, usuarioId, input);
  }

  // ── PATCH /proyectos/:proyectoId/edt/:id ──────────────────────────────────

  @Patch(':id')
  @RequirePermission(PERMISSIONS.EDT_WRITE)
  @ApiOperation({ summary: 'Actualizar datos de una partida (sin cambiar parent ni nivel)' })
  update(
    @Param('proyectoId') proyectoId: string,
    @Param('id') id: string,
    @Body() body: unknown,
    @Request() req: AuthRequest,
  ) {
    const input = zPartidaUpdate.parse(body);
    const { tenantId, sub: usuarioId, empresaId } = req.user;
    return this.partidaService.update(tenantId, proyectoId, empresaId, usuarioId, id, input);
  }

  // ── PATCH /proyectos/:proyectoId/edt/:id/reordenar ───────────────────────

  @Patch(':id/reordenar')
  @RequirePermission(PERMISSIONS.EDT_WRITE)
  @ApiOperation({ summary: 'Mover partida a nueva posición dentro de sus hermanos' })
  @ApiResponse({ status: 200, description: 'Lista de hermanos en el nuevo orden' })
  reordenar(
    @Param('proyectoId') proyectoId: string,
    @Param('id') id: string,
    @Body() body: unknown,
    @Request() req: AuthRequest,
  ) {
    const { nuevaPosicion } = zReordenarPartida.parse(body);
    const { tenantId, sub: usuarioId, empresaId } = req.user;
    return this.partidaService.reordenar(
      tenantId, proyectoId, empresaId, usuarioId, id, nuevaPosicion,
    );
  }

  // ── DELETE /proyectos/:proyectoId/edt/:id ────────────────────────────────

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission(PERMISSIONS.EDT_WRITE)
  @ApiOperation({ summary: 'Soft-delete de partida (falla si tiene hijos o movimientos)' })
  @ApiResponse({ status: 204, description: 'Eliminada' })
  @ApiResponse({ status: 409, description: 'Tiene movimientos en el Ledger' })
  @ApiResponse({ status: 422, description: 'Tiene sub-partidas activas' })
  async softDelete(
    @Param('proyectoId') proyectoId: string,
    @Param('id') id: string,
    @Request() req: AuthRequest,
  ) {
    const { tenantId, sub: usuarioId, empresaId } = req.user;
    await this.partidaService.softDelete(tenantId, proyectoId, empresaId, usuarioId, id);
  }

  // ── POST /proyectos/:proyectoId/edt/importar ─────────────────────────────

  @Post('importar')
  @RequirePermission(PERMISSIONS.EDT_WRITE)
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ description: 'Excel (.xlsx) con columnas: codigo, nombre, unidad, cantidad, precio_unitario' })
  @ApiOperation({
    summary: 'Importar EDT desde Excel',
    description:
      'El código jerárquico determina el nivel y el padre: "01"=capítulo, "01.01"=partida, "01.01.01"=sub-partida. ' +
      'Con simulacion=true valida sin guardar.',
  })
  @ApiQuery({ name: 'simulacion', required: false, type: Boolean })
  async importarEdt(
    @Param('proyectoId') proyectoId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Query('simulacion') simulacionStr: string | undefined,
    @Request() req: AuthRequest,
  ) {
    if (!file) throw new BadRequestException('Se requiere el campo "file" con el Excel.');
    const ext = file.originalname.toLowerCase();
    if (!ext.endsWith('.xlsx') && !ext.endsWith('.xls')) {
      throw new BadRequestException('Solo se aceptan archivos Excel (.xlsx o .xls).');
    }

    const simulacion = simulacionStr === 'true' || simulacionStr === '1';
    const { tenantId, sub: usuarioId, empresaId } = req.user;
    return this.partidaImporter.importar(
      file.buffer,
      { tenantId, usuarioId, empresaId, proyectoId },
      simulacion,
    );
  }
}
