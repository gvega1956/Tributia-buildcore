import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { LedgerModule } from '../ledger/ledger.module.js';
import { WorkflowModule } from '../workflow/workflow.module.js';
import { DisponibilidadService } from './disponibilidad.service.js';
import { RequisicionService } from './requisicion.service.js';
import { SolicitudCotizacionService } from './solicitud-cotizacion.service.js';
import { CotizacionService } from './cotizacion.service.js';
import { OrdenCompraService } from './orden-compra.service.js';
import { RequisicionController } from './requisicion.controller.js';
import { SolicitudCotizacionController } from './solicitud-cotizacion.controller.js';
import { CotizacionController } from './cotizacion.controller.js';
import { OrdenCompraController } from './orden-compra.controller.js';

@Module({
  imports: [DatabaseModule, LedgerModule, WorkflowModule],
  providers: [
    DisponibilidadService,
    RequisicionService,
    SolicitudCotizacionService,
    CotizacionService,
    OrdenCompraService,
  ],
  controllers: [
    RequisicionController,
    SolicitudCotizacionController,
    CotizacionController,
    OrdenCompraController,
  ],
  exports: [DisponibilidadService, RequisicionService, OrdenCompraService],
})
export class ComprasModule {}
