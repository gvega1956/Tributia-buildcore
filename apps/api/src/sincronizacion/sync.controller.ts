import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Request,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import type { Request as ExpressRequest } from 'express';
import type { JwtPayload } from '@tributia/core';
import { PERMISSIONS } from '@tributia/core';
import { RequireAuth } from '../iam/decorators/require-auth.decorator.js';
import { RequirePermission } from '../iam/decorators/require-permission.decorator.js';
import { SyncService, zBatchSyncDto } from './sync.service.js';
import { FotoCampoService, zRegistrarFotoDto } from './foto.service.js';

type AuthRequest = ExpressRequest & { user: JwtPayload };

@ApiTags('Sincronización Offline')
@ApiBearerAuth()
@Controller('api/v1/sync')
export class SyncController {
  constructor(
    private readonly syncSvc: SyncService,
    private readonly fotoSvc: FotoCampoService,
  ) {}

  /**
   * POST /api/v1/sync/batch
   * Envía un lote de operaciones offline al servidor.
   * Maneja idempotencia y resolución de conflictos por reglas de negocio.
   */
  @Post('batch')
  @RequireAuth()
  @RequirePermission(PERMISSIONS.SYNC_WRITE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sincronizar lote de operaciones offline' })
  async syncBatch(@Body() body: unknown, @Request() req: AuthRequest) {
    const result = zBatchSyncDto.safeParse(body);
    if (!result.success) {
      throw new BadRequestException(result.error.flatten());
    }
    return this.syncSvc.procesarBatch(req.user.tenantId, req.user.sub, result.data);
  }

  /**
   * GET /api/v1/sync/estado
   * Resumen del estado de la cola: pendientes, procesados, conflictos.
   */
  @Get('estado')
  @RequireAuth()
  @RequirePermission(PERMISSIONS.SYNC_WRITE)
  @ApiOperation({ summary: 'Estado de la cola de sincronización del tenant' })
  async estado(@Request() req: AuthRequest) {
    return this.syncSvc.obtenerEstado(req.user.tenantId);
  }

  /**
   * POST /api/v1/sync/fotos
   * Registra los metadatos de una foto capturada offline (geolocalización + hash).
   * La foto en sí se sube cuando hay señal vía POST /sync/fotos/:id/confirmar.
   */
  @Post('fotos')
  @RequireAuth()
  @RequirePermission(PERMISSIONS.SYNC_WRITE)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Registrar metadatos de foto capturada offline' })
  async registrarFoto(@Body() body: unknown, @Request() req: AuthRequest) {
    const result = zRegistrarFotoDto.safeParse(body);
    if (!result.success) {
      throw new BadRequestException(result.error.flatten());
    }
    return this.fotoSvc.registrarFoto(req.user.tenantId, req.user.sub, result.data);
  }

  /**
   * POST /api/v1/sync/fotos/:id/confirmar
   * Confirma que el archivo binario fue subido a S3/MinIO.
   * Recibe el storage_key asignado por el servicio de almacenamiento.
   */
  @Post('fotos/:id/confirmar')
  @RequireAuth()
  @RequirePermission(PERMISSIONS.SYNC_WRITE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirmar subida de foto a S3/MinIO' })
  async confirmarSubida(
    @Param('id') fotoId: string,
    @Body() body: unknown,
    @Request() req: AuthRequest,
  ) {
    const storageKey = (body as Record<string, unknown>)['storageKey'];
    if (typeof storageKey !== 'string' || !storageKey) {
      throw new BadRequestException('storageKey requerido');
    }
    return this.fotoSvc.confirmarSubida(req.user.tenantId, fotoId, storageKey, req.user.sub);
  }

  /**
   * GET /api/v1/sync/fotos/pendientes
   * Lista fotos pendientes de subida del tenant.
   */
  @Get('fotos/pendientes')
  @RequireAuth()
  @RequirePermission(PERMISSIONS.SYNC_WRITE)
  @ApiOperation({ summary: 'Listar fotos pendientes de subida' })
  async fotosPendientes(@Request() req: AuthRequest) {
    return this.fotoSvc.listarPendientes(req.user.tenantId);
  }
}
