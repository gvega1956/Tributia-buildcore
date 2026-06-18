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
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { ApiZodBody } from '../shared/api-zod-body.decorator.js';
import type { Request as ExpressRequest } from 'express';
import type { JwtPayload } from '@tributia/core';
import { PERMISSIONS } from '@tributia/core';
import {
  zApuCreate,
  zApuUpdate,
  zApuLineaCreate,
  zApuLineaUpdate,
} from '@tributia/proyectos';
import { RequireAuth } from '../iam/decorators/require-auth.decorator.js';
import { RequirePermission } from '../iam/decorators/require-permission.decorator.js';
import { ApuService } from './apu.service.js';

type AuthRequest = ExpressRequest & { user: JwtPayload };

// ── APU de partida: /api/v1/proyectos/:proyectoId/edt/:partidaId/apu ─────────

@ApiTags('APU')
@ApiBearerAuth()
@Controller('api/v1/proyectos/:proyectoId/edt/:partidaId/apu')
export class ApuController {
  constructor(private readonly apuService: ApuService) {}

  @Get()
  @RequireAuth()
  @ApiOperation({ summary: 'Obtener APU de una partida' })
  @ApiResponse({ status: 200, description: 'APU con sus líneas' })
  @ApiResponse({ status: 404, description: 'La partida no tiene APU definido' })
  findParaPartida(
    @Param('proyectoId') proyectoId: string,
    @Param('partidaId') partidaId: string,
    @Request() req: AuthRequest,
  ) {
    const { tenantId, sub: usuarioId, empresaId } = req.user;
    return this.apuService.findParaPartida(tenantId, proyectoId, empresaId, usuarioId, partidaId);
  }

  @Post()
  @RequirePermission(PERMISSIONS.APU_WRITE)
  @ApiOperation({ summary: 'Crear APU para una partida' })
  @ApiZodBody(zApuCreate)
  @ApiResponse({ status: 201, description: 'APU creado' })
  @ApiResponse({ status: 409, description: 'La partida ya tiene un APU' })
  createParaPartida(
    @Param('proyectoId') proyectoId: string,
    @Param('partidaId') partidaId: string,
    @Body() body: unknown,
    @Request() req: AuthRequest,
  ) {
    const input = zApuCreate.parse(body);
    const { tenantId, sub: usuarioId, empresaId } = req.user;
    return this.apuService.createParaPartida(
      tenantId, proyectoId, empresaId, usuarioId, partidaId, input,
    );
  }

  @Patch()
  @RequirePermission(PERMISSIONS.APU_WRITE)
  @ApiOperation({ summary: 'Actualizar metadatos del APU (nombre, descripción, unidad)' })
  @ApiZodBody(zApuUpdate)
  updateParaPartida(
    @Param('proyectoId') proyectoId: string,
    @Param('partidaId') partidaId: string,
    @Body() body: unknown,
    @Request() req: AuthRequest,
  ) {
    const input = zApuUpdate.parse(body);
    const { tenantId, sub: usuarioId, empresaId } = req.user;
    return this.apuService.updateParaPartida(
      tenantId, proyectoId, empresaId, usuarioId, partidaId, input,
    );
  }

  // ── Líneas del APU ─────────────────────────────────────────────────────────

  @Post('lineas')
  @RequirePermission(PERMISSIONS.APU_WRITE)
  @ApiOperation({ summary: 'Añadir línea al APU (material, mano de obra, equipo o subcontrato)' })
  @ApiZodBody(zApuLineaCreate)
  addLinea(
    @Param('proyectoId') proyectoId: string,
    @Param('partidaId') partidaId: string,
    @Body() body: unknown,
    @Request() req: AuthRequest,
  ) {
    const input = zApuLineaCreate.parse(body);
    const { tenantId, sub: usuarioId, empresaId } = req.user;
    return this.apuService.addLinea(
      tenantId, proyectoId, empresaId, usuarioId, partidaId, input,
    );
  }

  @Patch('lineas/:lineaId')
  @RequirePermission(PERMISSIONS.APU_WRITE)
  @ApiOperation({ summary: 'Actualizar línea del APU' })
  @ApiZodBody(zApuLineaUpdate)
  updateLinea(
    @Param('proyectoId') proyectoId: string,
    @Param('partidaId') partidaId: string,
    @Param('lineaId') lineaId: string,
    @Body() body: unknown,
    @Request() req: AuthRequest,
  ) {
    const input = zApuLineaUpdate.parse(body);
    const { tenantId, sub: usuarioId, empresaId } = req.user;
    return this.apuService.updateLinea(
      tenantId, proyectoId, empresaId, usuarioId, partidaId, lineaId, input,
    );
  }

  @Delete('lineas/:lineaId')
  @HttpCode(204)
  @RequirePermission(PERMISSIONS.APU_WRITE)
  @ApiOperation({ summary: 'Eliminar línea del APU' })
  @ApiResponse({ status: 204, description: 'Línea eliminada' })
  async removeLinea(
    @Param('proyectoId') proyectoId: string,
    @Param('partidaId') partidaId: string,
    @Param('lineaId') lineaId: string,
    @Request() req: AuthRequest,
  ) {
    const { tenantId, sub: usuarioId, empresaId } = req.user;
    await this.apuService.removeLinea(
      tenantId, proyectoId, empresaId, usuarioId, partidaId, lineaId,
    );
  }
}

// ── Biblioteca de APUs: /api/v1/apu/biblioteca ────────────────────────────────

@ApiTags('APU')
@ApiBearerAuth()
@Controller('api/v1/apu/biblioteca')
export class ApuBibliotecaController {
  constructor(private readonly apuService: ApuService) {}

  @Get()
  @RequireAuth()
  @ApiOperation({ summary: 'Listar APUs de la biblioteca del tenant' })
  findAll(@Request() req: AuthRequest) {
    const { tenantId } = req.user;
    return this.apuService.findAllBiblioteca(tenantId);
  }

  @Get(':id')
  @RequireAuth()
  @ApiOperation({ summary: 'Obtener APU de biblioteca por ID (con líneas)' })
  findOne(@Param('id') id: string, @Request() req: AuthRequest) {
    const { tenantId } = req.user;
    return this.apuService.findBibliotecaById(tenantId, id);
  }

  @Post()
  @RequirePermission(PERMISSIONS.APU_WRITE)
  @ApiOperation({ summary: 'Crear APU en la biblioteca (reutilizable entre proyectos)' })
  @ApiZodBody(zApuCreate)
  create(@Body() body: unknown, @Request() req: AuthRequest) {
    const input = zApuCreate.parse(body);
    const { tenantId, sub: usuarioId } = req.user;
    return this.apuService.createBiblioteca(tenantId, usuarioId, input);
  }

  @Post(':id/copiar-a-partida/:partidaId')
  @RequirePermission(PERMISSIONS.APU_WRITE)
  @ApiOperation({
    summary: 'Copiar APU de biblioteca a una partida de un proyecto',
    description: 'Crea un APU nuevo para la partida, copiando todas las líneas del template.',
  })
  copiarAPartida(
    @Param('id') apuBibliotecaId: string,
    @Param('partidaId') partidaId: string,
    @Body() body: { proyectoId: string },
    @Request() req: AuthRequest,
  ) {
    const { tenantId, sub: usuarioId, empresaId } = req.user;
    return this.apuService.copiarBibliotecaAPartida(
      tenantId, body.proyectoId, empresaId, usuarioId, partidaId, apuBibliotecaId,
    );
  }
}
