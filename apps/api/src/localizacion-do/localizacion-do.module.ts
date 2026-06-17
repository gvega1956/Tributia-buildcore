import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { LedgerModule } from '../ledger/ledger.module.js';
import { CatalogosModule } from '../catalogos/catalogos.module.js';
import { EmisionEcfService } from './emision-ecf.service.js';
import { ConfiguracionEmisorEcfService } from './configuracion-emisor-ecf.service.js';
import { ReporteDgiiService } from './reporte-dgii.service.js';
import { FakeMiddlewareEcfAdapter } from './fake-middleware-ecf.adapter.js';
import { MIDDLEWARE_ECF_CLIENT } from './middleware-ecf-client.token.js';
import { EmisionEcfController, ConfiguracionEmisorEcfController } from './emision-ecf.controller.js';
import { ReporteDgiiController } from './reporte-dgii.controller.js';

/**
 * LocalizacionDoModule — emisión e-CF (ADR-0007) + reportes DGII (ADR-0010).
 *
 * El middleware e-CF es un servicio externo ya existente; este módulo solo
 * provee el adaptador (`MIDDLEWARE_ECF_CLIENT`) que cumple el puerto
 * `IMiddlewareEcfClient` de @tributia/localizacion-do. Hoy es
 * `FakeMiddlewareEcfAdapter` (log-only, igual patrón que SmtpAdapter) — el
 * día que haya un middleware real alcanzable, solo se cambia este provider.
 */
@Module({
  imports: [DatabaseModule, LedgerModule, CatalogosModule],
  providers: [
    EmisionEcfService,
    ConfiguracionEmisorEcfService,
    ReporteDgiiService,
    { provide: MIDDLEWARE_ECF_CLIENT, useClass: FakeMiddlewareEcfAdapter },
  ],
  controllers: [EmisionEcfController, ConfiguracionEmisorEcfController, ReporteDgiiController],
  exports: [EmisionEcfService, ConfiguracionEmisorEcfService, ReporteDgiiService],
})
export class LocalizacionDoModule {}
