import {
  Controller,
  Post,
  Get,
  Query,
  Request,
  Body,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
  Res,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiConsumes,
  ApiBody,
  ApiQuery,
} from '@nestjs/swagger';
import ExcelJS from 'exceljs';
import type { Request as ExpressRequest, Response } from 'express';
import type { JwtPayload } from '@tributia/core';
import { PERMISSIONS } from '@tributia/core';
import { RequirePermission } from '../iam/decorators/require-permission.decorator.js';
import { DbService } from '../database/db.service.js';
import { InsumoService } from '../catalogos/insumo.service.js';
import { InsumoImporter } from './insumo.importer.js';

@ApiTags('importadores')
@ApiBearerAuth()
@Controller('api/v1/importadores')
export class ImportadorController {
  constructor(
    private readonly db: DbService,
    private readonly insumoService: InsumoService,
  ) {}

  // ── POST /importadores/insumos ─────────────────────────────────────────────

  @Post('insumos')
  @RequirePermission(PERMISSIONS.INSUMO_WRITE)
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ description: 'Archivo Excel (.xlsx) con catálogo de insumos' })
  @ApiOperation({
    summary: 'Importar catálogo de insumos desde Excel',
    description:
      'Columnas: codigo, nombre, descripcion, unidad, categoria, codigo_dgii. ' +
      'Con simulacion=true valida sin guardar.',
  })
  @ApiQuery({ name: 'simulacion', required: false, type: Boolean })
  @ApiResponse({ status: 201, description: 'Resultado de la importación' })
  @ApiResponse({ status: 400, description: 'Archivo inválido o sin columnas reconocibles' })
  async importarInsumos(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Query('simulacion') simulacionStr: string | undefined,
    @Request() req: ExpressRequest & { user: JwtPayload },
  ) {
    if (!file) throw new BadRequestException('Se requiere el campo "file" con el Excel.');
    const ext = file.originalname.toLowerCase();
    if (!ext.endsWith('.xlsx') && !ext.endsWith('.xls')) {
      throw new BadRequestException('Solo se aceptan archivos Excel (.xlsx o .xls).');
    }

    const simulacion = simulacionStr === 'true' || simulacionStr === '1';
    const importer = new InsumoImporter(this.db, this.insumoService);
    const result = await importer.importar(
      file.buffer,
      { tenantId: req.user.tenantId, usuarioId: req.user.sub },
      simulacion,
    );
    return result;
  }

  // ── GET /importadores/insumos/plantilla ───────────────────────────────────

  @Get('insumos/plantilla')
  @RequirePermission(PERMISSIONS.INSUMO_READ)
  @ApiOperation({ summary: 'Descargar plantilla Excel para importación de insumos' })
  @ApiResponse({ status: 200, description: 'Archivo Excel con encabezados y ejemplo' })
  async plantillaInsumos(@Res() res: Response) {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Insumos');

    sheet.columns = [
      { header: 'codigo',       key: 'codigo',       width: 15 },
      { header: 'nombre',       key: 'nombre',       width: 35 },
      { header: 'descripcion',  key: 'descripcion',  width: 40 },
      { header: 'unidad',       key: 'unidad',       width: 12 },
      { header: 'categoria',    key: 'categoria',    width: 20 },
      { header: 'codigo_dgii',  key: 'codigo_dgii',  width: 15 },
    ];

    sheet.addRow({
      codigo: 'CEM-01',
      nombre: 'Cemento Portland Tipo I',
      descripcion: 'Saco 42.5 kg',
      unidad: 'SC',
      categoria: 'MATERIAL',
      codigo_dgii: '',
    });

    sheet.addRow({
      codigo: 'VAR-3/8',
      nombre: 'Varilla corrugada 3/8"',
      descripcion: 'Acero ASTM A615 Gr.60',
      unidad: 'KG',
      categoria: 'MATERIAL',
      codigo_dgii: '',
    });

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', 'attachment; filename="plantilla-insumos.xlsx"');

    await workbook.xlsx.write(res);
    res.end();
  }

  // ── GET /importadores/insumos/reporte-errores ─────────────────────────────

  @Post('insumos/reporte-errores')
  @RequirePermission(PERMISSIONS.INSUMO_READ)
  @ApiOperation({ summary: 'Generar CSV descargable con errores de importación' })
  @ApiBody({ description: 'Array de FilaError del resultado de importación' })
  @ApiResponse({ status: 200, description: 'CSV con errores' })
  reporteErroresCSV(
    @Body() body: unknown,
    @Res() res: Response,
  ) {
    const { errores } = body as { errores: { fila: number; campo?: string; error: string; valorRecibido?: unknown }[] };
    if (!Array.isArray(errores)) {
      throw new BadRequestException('Se requiere el campo "errores" como array.');
    }

    const importer = new InsumoImporter(this.db, this.insumoService);
    const csv = importer.generarReporteCSV({ totalFilas: 0, procesadas: 0, omitidas: errores.length, errores, simulacion: false });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="errores-importacion.csv"');
    res.send(csv);
  }
}
