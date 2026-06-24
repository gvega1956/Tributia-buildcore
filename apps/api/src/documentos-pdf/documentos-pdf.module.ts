import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { ComprasModule } from '../compras/compras.module.js';
import { CxcModule } from '../cxc/cxc.module.js';
import { PdfRenderService } from './pdf-render.service.js';
import { DocumentosPdfService } from './documentos-pdf.service.js';
import { DocumentosPdfController } from './documentos-pdf.controller.js';

@Module({
  imports: [DatabaseModule, ComprasModule, CxcModule],
  providers: [PdfRenderService, DocumentosPdfService],
  controllers: [DocumentosPdfController],
})
export class DocumentosPdfModule {}
