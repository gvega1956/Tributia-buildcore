import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Request,
  Body,
  UploadedFile,
  UseInterceptors,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiConsumes, ApiBody } from '@nestjs/swagger';
import type { Request as ExpressRequest } from 'express';
import { ArchivoService } from './archivo.service.js';
import { RequirePermission } from '../iam/decorators/require-permission.decorator.js';
import { PERMISSIONS } from '@tributia/core';
import {
  zSubirArchivo,
  zSubirNuevaVersion,
  zListarArchivos,
  zProximosVencimientos,
} from '@tributia/documental';
import type { JwtPayload } from '@tributia/core';

@ApiTags('documental')
@ApiBearerAuth()
@Controller('api/v1/documentos')
export class ArchivoController {
  constructor(private readonly service: ArchivoService) {}

  // ── Listar por entidad ────────────────────────────────────────────────────

  @Get()
  @RequirePermission(PERMISSIONS.DOCUMENTO_READ)
  @ApiOperation({ summary: 'Listar archivos (filtrando por entidad o categoría)' })
  @ApiResponse({ status: 200 })
  async list(
    @Query() query: unknown,
    @Request() req: ExpressRequest & { user: JwtPayload },
  ) {
    const { entidadTipo, entidadId } = zListarArchivos.parse(query);
    if (!entidadTipo || !entidadId) {
      throw new BadRequestException('Se requieren entidadTipo y entidadId para filtrar.');
    }
    return this.service.listByEntidad(req.user.tenantId, entidadTipo, entidadId);
  }

  // ── Próximos vencimientos ─────────────────────────────────────────────────

  @Get('proximos-vencimientos')
  @RequirePermission(PERMISSIONS.DOCUMENTO_READ)
  @ApiOperation({ summary: 'Documentos con vencimiento próximo (configurable, default 30 días)' })
  @ApiResponse({ status: 200 })
  async proximosVencimientos(
    @Query() query: unknown,
    @Request() req: ExpressRequest & { user: JwtPayload },
  ) {
    const { diasHasta } = zProximosVencimientos.parse(query);
    return this.service.listProximosVencimientos(req.user.tenantId, diasHasta);
  }

  // ── Ver versiones de un archivo ───────────────────────────────────────────

  @Get(':id/versiones')
  @RequirePermission(PERMISSIONS.DOCUMENTO_READ)
  @ApiOperation({ summary: 'Historial de versiones de un archivo' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404 })
  getVersiones(@Param('id') id: string) {
    return this.service.getVersiones(id);
  }

  // ── URL de descarga ───────────────────────────────────────────────────────

  @Get(':id/descargar')
  @RequirePermission(PERMISSIONS.DOCUMENTO_READ)
  @ApiOperation({ summary: 'Obtener URL presignada de descarga (válida 1 hora)' })
  @ApiResponse({ status: 200 })
  async descargar(
    @Param('id') id: string,
    @Query('version') version?: string,
  ) {
    const numeroVersion = version ? parseInt(version, 10) : undefined;
    return this.service.getPresignedDownloadUrl(id, numeroVersion);
  }

  // ── Subir archivo (v1) ────────────────────────────────────────────────────

  @Post()
  @RequirePermission(PERMISSIONS.DOCUMENTO_WRITE)
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ description: 'Archivo + metadatos (multipart/form-data)' })
  @ApiOperation({ summary: 'Subir nuevo archivo vinculado a una entidad' })
  @ApiResponse({ status: 201 })
  @ApiResponse({ status: 400 })
  async subir(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: unknown,
    @Request() req: ExpressRequest & { user: JwtPayload },
  ) {
    if (!file) throw new BadRequestException('Se requiere el campo "file".');
    const input = zSubirArchivo.parse(body);
    return this.service.subirArchivo(
      req.user.tenantId,
      req.user.sub,
      input,
      file.buffer,
      file.mimetype,
    );
  }

  // ── Subir nueva versión ───────────────────────────────────────────────────

  @Post(':id/versiones')
  @RequirePermission(PERMISSIONS.DOCUMENTO_WRITE)
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ description: 'Archivo reemplazante (multipart/form-data)' })
  @ApiOperation({ summary: 'Subir nueva versión de un archivo existente' })
  @ApiResponse({ status: 201 })
  @ApiResponse({ status: 404 })
  @HttpCode(HttpStatus.CREATED)
  async subirVersion(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: unknown,
    @Request() req: ExpressRequest & { user: JwtPayload },
  ) {
    if (!file) throw new BadRequestException('Se requiere el campo "file".');
    const input = zSubirNuevaVersion.parse(body);
    return this.service.subirNuevaVersion(
      id,
      req.user.tenantId,
      req.user.sub,
      input,
      file.buffer,
      file.mimetype,
    );
  }
}
