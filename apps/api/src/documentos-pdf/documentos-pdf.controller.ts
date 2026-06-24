import { Controller, Get, Param, Request, Res } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import type { Request as ExpressRequest, Response as ExpressResponse } from 'express';
import type { JwtPayload } from '@tributia/core';
import { PERMISSIONS } from '@tributia/core';
import { RequireAuth } from '../iam/decorators/require-auth.decorator.js';
import { RequirePermission } from '../iam/decorators/require-permission.decorator.js';
import { DocumentosPdfService } from './documentos-pdf.service.js';

type AuthRequest = ExpressRequest & { user: JwtPayload };

@ApiTags('Documentos PDF')
@ApiBearerAuth()
@Controller('api/v1/documentos')
export class DocumentosPdfController {
  constructor(private readonly svc: DocumentosPdfService) {}

  @Get('orden-compra/:id/pdf')
  @RequireAuth()
  @RequirePermission(PERMISSIONS.OC_PDF)
  @ApiOperation({ summary: 'Genera y descarga el PDF de una Orden de Compra' })
  async ordenCompraPdf(
    @Param('id') id: string,
    @Request() req: AuthRequest,
    @Res() res: ExpressResponse,
  ) {
    const buffer = await this.svc.generarOrdenCompraPdf(req.user.tenantId, id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="OC-${id}.pdf"`);
    res.setHeader('Content-Length', buffer.length);
    res.end(buffer);
  }

  @Get('cubicacion/:id/pdf')
  @RequireAuth()
  @RequirePermission(PERMISSIONS.CUBICACION_PDF)
  @ApiOperation({ summary: 'Genera y descarga el PDF de una Cubicación' })
  async cubicacionPdf(
    @Param('id') id: string,
    @Request() req: AuthRequest,
    @Res() res: ExpressResponse,
  ) {
    const buffer = await this.svc.generarCubicacionPdf(req.user.tenantId, id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Cubicacion-${id}.pdf"`);
    res.setHeader('Content-Length', buffer.length);
    res.end(buffer);
  }

  @Get('factura-cliente/:id/pdf')
  @RequireAuth()
  @RequirePermission(PERMISSIONS.FACTURA_CLI_PDF)
  @ApiOperation({ summary: 'Genera y descarga el PDF de una Factura de Cliente' })
  async facturaClientePdf(
    @Param('id') id: string,
    @Request() req: AuthRequest,
    @Res() res: ExpressResponse,
  ) {
    const buffer = await this.svc.generarFacturaClientePdf(req.user.tenantId, id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Factura-${id}.pdf"`);
    res.setHeader('Content-Length', buffer.length);
    res.end(buffer);
  }
}
