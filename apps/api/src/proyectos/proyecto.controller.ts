import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  Request,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import type { Request as ExpressRequest } from 'express';
import { ProyectoService } from './proyecto.service.js';
import { RequirePermission } from '../iam/decorators/require-permission.decorator.js';
import { RequireAuth } from '../iam/decorators/require-auth.decorator.js';
import { PERMISSIONS } from '@tributia/core';
import {
  zProyectoCreate,
  zProyectoUpdate,
  zTransicionEstado,
  zAsignarEquipo,
} from '@tributia/proyectos';
import type { JwtPayload } from '@tributia/core';

type AuthReq = ExpressRequest & { user: JwtPayload };

@ApiTags('proyectos')
@ApiBearerAuth()
@Controller('api/v1/proyectos')
export class ProyectoController {
  constructor(private readonly service: ProyectoService) {}

  // ── CRUD ─────────────────────────────────────────────────────────────────

  /**
   * Lista proyectos accesibles al usuario.
   * - proyecto:read a nivel empresa → todos los proyectos de la empresa.
   * - Solo asignación vía usuario_rol_proyecto → solo los proyectos asignados.
   * No requiere permiso empresa (el filtrado lo hace el servicio).
   */
  @Get()
  @RequireAuth()
  @ApiOperation({ summary: 'Listar proyectos accesibles al usuario' })
  @ApiResponse({ status: 200, description: 'Lista de proyectos' })
  findAll(@Request() req: AuthReq) {
    return this.service.findAll(req.user.tenantId, req.user.empresaId, req.user.sub);
  }

  @Post()
  @RequirePermission(PERMISSIONS.PROYECTO_WRITE)
  @ApiOperation({ summary: 'Crear proyecto (estado inicial: PROSPECTO)' })
  @ApiResponse({ status: 201, description: 'Proyecto creado' })
  @ApiResponse({ status: 409, description: 'Código duplicado en esta empresa' })
  @ApiResponse({ status: 422, description: 'Tercero no tiene rol cliente' })
  create(@Body() body: unknown, @Request() req: AuthReq) {
    const input = zProyectoCreate.parse(body);
    return this.service.create(req.user.tenantId, req.user.empresaId, req.user.sub, input);
  }

  @Get(':id')
  @RequireAuth()
  @ApiOperation({ summary: 'Obtener un proyecto por ID' })
  @ApiResponse({ status: 200, description: 'Proyecto encontrado' })
  @ApiResponse({ status: 403, description: 'Sin acceso a este proyecto' })
  @ApiResponse({ status: 404, description: 'No encontrado' })
  findOne(@Param('id') id: string, @Request() req: AuthReq) {
    return this.service.findById(id, req.user.tenantId, req.user.empresaId, req.user.sub);
  }

  @Put(':id')
  @RequirePermission(PERMISSIONS.PROYECTO_WRITE)
  @ApiOperation({ summary: 'Actualizar datos del proyecto' })
  @ApiResponse({ status: 200, description: 'Proyecto actualizado' })
  update(@Param('id') id: string, @Body() body: unknown, @Request() req: AuthReq) {
    const input = zProyectoUpdate.parse(body);
    return this.service.update(id, req.user.tenantId, req.user.empresaId, req.user.sub, input);
  }

  @Delete(':id')
  @RequirePermission(PERMISSIONS.PROYECTO_WRITE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Eliminar (soft-delete) proyecto' })
  @ApiResponse({ status: 204, description: 'Proyecto eliminado' })
  async remove(@Param('id') id: string, @Request() req: AuthReq) {
    await this.service.softDelete(id, req.user.tenantId, req.user.empresaId, req.user.sub);
  }

  // ── Ciclo de estados ─────────────────────────────────────────────────────

  @Patch(':id/estado')
  @RequirePermission(PERMISSIONS.PROYECTO_WRITE)
  @ApiOperation({ summary: 'Avanzar el estado del proyecto (máquina de estados unidireccional)' })
  @ApiResponse({ status: 200, description: 'Estado actualizado' })
  @ApiResponse({ status: 422, description: 'Transición de estado inválida' })
  transicionarEstado(
    @Param('id') id: string,
    @Body() body: unknown,
    @Request() req: AuthReq,
  ) {
    const { estado } = zTransicionEstado.parse(body);
    return this.service.transicionarEstado(
      id,
      req.user.tenantId,
      req.user.empresaId,
      req.user.sub,
      estado,
    );
  }

  // ── Equipo ───────────────────────────────────────────────────────────────

  @Get(':id/equipo')
  @RequireAuth()
  @ApiOperation({ summary: 'Listar miembros del equipo del proyecto' })
  @ApiResponse({ status: 200, description: 'Equipo del proyecto' })
  listarEquipo(@Param('id') id: string, @Request() req: AuthReq) {
    return this.service.listarEquipo(
      id,
      req.user.tenantId,
      req.user.empresaId,
      req.user.sub,
    );
  }

  @Post(':id/equipo')
  @RequirePermission(PERMISSIONS.PROYECTO_WRITE)
  @ApiOperation({ summary: 'Asignar miembro al equipo del proyecto' })
  @ApiResponse({ status: 201, description: 'Miembro asignado' })
  @ApiResponse({ status: 409, description: 'Usuario ya asignado' })
  @HttpCode(HttpStatus.CREATED)
  asignarEquipo(
    @Param('id') id: string,
    @Body() body: unknown,
    @Request() req: AuthReq,
  ) {
    const input = zAsignarEquipo.parse(body);
    return this.service.asignarEquipo(id, req.user.tenantId, req.user.sub, input);
  }

  @Delete(':id/equipo/:usuarioId')
  @RequirePermission(PERMISSIONS.PROYECTO_WRITE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remover miembro del equipo del proyecto' })
  @ApiResponse({ status: 204, description: 'Miembro removido' })
  async removerEquipo(
    @Param('id') id: string,
    @Param('usuarioId') miembroId: string,
    @Request() req: AuthReq,
  ) {
    await this.service.removerEquipo(id, miembroId, req.user.tenantId, req.user.sub);
  }
}
