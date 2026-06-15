import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { LedgerModule } from '../ledger/ledger.module.js';
import { WorkflowModule } from '../workflow/workflow.module.js';
import { DisponibilidadService } from './disponibilidad.service.js';
import { RequisicionService } from './requisicion.service.js';
import { SolicitudCotizacionService } from './solicitud-cotizacion.service.js';
import { CotizacionService } from './cotizacion.service.js';
import { OrdenCompraService } from './orden-compra.service.js';
import { RecepcionOcService } from './recepcion-oc.service.js';
import { FacturaProveedorService } from './factura-proveedor.service.js';
import { CuentaPorPagarService } from './cuenta-por-pagar.service.js';
import { AnticipoProveedorService } from './anticipo-proveedor.service.js';
import { ScoringProveedorService } from './scoring-proveedor.service.js';
import { RequisicionController } from './requisicion.controller.js';
import { SolicitudCotizacionController } from './solicitud-cotizacion.controller.js';
import { CotizacionController } from './cotizacion.controller.js';
import { OrdenCompraController } from './orden-compra.controller.js';
import { RecepcionOcController } from './recepcion-oc.controller.js';
import { FacturaProveedorController } from './factura-proveedor.controller.js';
import {
  CuentaPorPagarController,
  AnticipoProveedorController,
  ScoringProveedorController,
} from './cuenta-por-pagar.controller.js';

@Module({
  imports: [DatabaseModule, LedgerModule, WorkflowModule],
  providers: [
    DisponibilidadService,
    RequisicionService,
    SolicitudCotizacionService,
    CotizacionService,
    OrdenCompraService,
    RecepcionOcService,
    FacturaProveedorService,
    CuentaPorPagarService,
    AnticipoProveedorService,
    ScoringProveedorService,
  ],
  controllers: [
    RequisicionController,
    SolicitudCotizacionController,
    CotizacionController,
    OrdenCompraController,
    RecepcionOcController,
    FacturaProveedorController,
    CuentaPorPagarController,
    AnticipoProveedorController,
    ScoringProveedorController,
  ],
  exports: [
    DisponibilidadService,
    RequisicionService,
    OrdenCompraService,
    RecepcionOcService,
    CuentaPorPagarService,
  ],
})
export class ComprasModule {}
