import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Request,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import type { Request as ExpressRequest } from 'express';
import { WorkflowService } from './workflow.service.js';
import { RequirePermission } from '../iam/decorators/require-permission.decorator.js';
import { PERMISSIONS } from '@tributia/core';
import {
  zIniciarFlujo,
  zResponderAprobacion,
  zRechazarAprobacion,
  zDelegarAprobacion,
  zCancelarFlujo,
} from '@tributia/workflow';
import type { JwtPayload } from '@tributia/core';

@ApiTags('workflow')
@ApiBearerAuth()
@Controller('api/v1/workflow')
export class WorkflowController {
  constructor(private readonly service: WorkflowService) {}

  // ── Iniciar flujo ──────────────────────────────────────────────────────────

  @Post('instancias')
  @RequirePermission(PERMISSIONS.FLUJO_APROBAR)
  @ApiOperation({ summary: 'Iniciar flujo de aprobación para un documento' })
  @ApiResponse({ status: 201, description: 'Instancia de flujo creada' })
  @ApiResponse({ status: 400, description: 'No existe flujo configurado para el tipo de documento' })
  iniciar(
    @Body() body: unknown,
    @Request() req: ExpressRequest & { user: JwtPayload },
  ) {
    const input = zIniciarFlujo.parse(body);
    return this.service.iniciarFlujo(req.user.tenantId, req.user.sub, input);
  }

  // ── Pendientes ─────────────────────────────────────────────────────────────

  @Get('pendientes')
  @RequirePermission(PERMISSIONS.FLUJO_APROBAR)
  @ApiOperation({ summary: 'Listar aprobaciones pendientes del usuario autenticado' })
  @ApiResponse({ status: 200 })
  pendientes(@Request() req: ExpressRequest & { user: JwtPayload }) {
    return this.service.pendientesPorUsuario(req.user.sub, req.user.tenantId);
  }

  // ── Consultar instancia ────────────────────────────────────────────────────

  @Get('instancias/:id')
  @RequirePermission(PERMISSIONS.FLUJO_LEER)
  @ApiOperation({ summary: 'Obtener instancia de flujo con historial completo de aprobaciones' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404 })
  historial(@Param('id') id: string) {
    return this.service.historialInstancia(id);
  }

  // ── Aprobar ────────────────────────────────────────────────────────────────

  @Post('aprobaciones/:id/aprobar')
  @RequirePermission(PERMISSIONS.FLUJO_APROBAR)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Aprobar una aprobación pendiente' })
  @ApiResponse({ status: 200, description: 'Aprobación registrada; el flujo avanza si corresponde' })
  @ApiResponse({ status: 403, description: 'El usuario no es el aprobador asignado' })
  @ApiResponse({ status: 409, description: 'La aprobación ya fue respondida' })
  aprobar(
    @Param('id') id: string,
    @Body() body: unknown,
    @Request() req: ExpressRequest & { user: JwtPayload },
  ) {
    const input = zResponderAprobacion.parse(body);
    return this.service.aprobar(id, req.user.sub, input);
  }

  // ── Rechazar ───────────────────────────────────────────────────────────────

  @Post('aprobaciones/:id/rechazar')
  @RequirePermission(PERMISSIONS.FLUJO_APROBAR)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rechazar una aprobación (toda la instancia queda RECHAZADA)' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 403 })
  @ApiResponse({ status: 409 })
  rechazar(
    @Param('id') id: string,
    @Body() body: unknown,
    @Request() req: ExpressRequest & { user: JwtPayload },
  ) {
    const input = zRechazarAprobacion.parse(body);
    return this.service.rechazar(id, req.user.sub, input);
  }

  // ── Delegar ────────────────────────────────────────────────────────────────

  @Post('aprobaciones/:id/delegar')
  @RequirePermission(PERMISSIONS.FLUJO_APROBAR)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delegar una aprobación a otro usuario' })
  @ApiResponse({ status: 200, description: 'Nueva aprobación creada para el delegado' })
  @ApiResponse({ status: 403, description: 'El paso no permite delegación o el usuario no es el aprobador' })
  delegar(
    @Param('id') id: string,
    @Body() body: unknown,
    @Request() req: ExpressRequest & { user: JwtPayload },
  ) {
    const input = zDelegarAprobacion.parse(body);
    return this.service.delegar(id, req.user.sub, input);
  }

  // ── Cancelar instancia ─────────────────────────────────────────────────────

  @Post('instancias/:id/cancelar')
  @RequirePermission(PERMISSIONS.FLUJO_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancelar un flujo en progreso' })
  @ApiResponse({ status: 200, description: 'Flujo cancelado' })
  @ApiResponse({ status: 409, description: 'El flujo no está EN_PROGRESO' })
  cancelar(
    @Param('id') id: string,
    @Body() body: unknown,
    @Request() req: ExpressRequest & { user: JwtPayload },
  ) {
    const input = zCancelarFlujo.parse(body);
    return this.service.cancelarFlujo(id, req.user.sub, input);
  }
}
